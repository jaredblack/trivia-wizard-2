use anyhow::Result;
use aws_config::BehaviorVersion;
use aws_config::meta::region::RegionProviderChain;
use aws_sdk_ec2::Client as Ec2Client;
use aws_sdk_ecs::Client as EcsClient;
use aws_sdk_route53::Client as Route53Client;
use aws_sdk_route53::types::{Change, ChangeAction, ResourceRecord, ResourceRecordSet, RrType};
use log::{info, warn};
use serde_json::Value;
use std::env;
use std::error::Error;
use tokio_retry::Retry;
use tokio_retry::strategy::{ExponentialBackoff, jitter};

pub fn is_local() -> bool {
    if env::var("ECS_CONTAINER_METADATA_URI_V4").is_ok() {
        return false;
    }
    env::var("IS_LOCAL_MAC")
        .ok()
        .filter(|v| !v.is_empty())
        .expect("IS_LOCAL_MAC env var must be set and non-empty to run in local mode");
    true
}

pub fn is_test() -> bool {
    cfg!(feature = "test-support")
}

#[derive(Debug)]
pub struct ServiceDiscovery {
    ecs_client: EcsClient,
    route53_client: Route53Client,
    ec2_client: Ec2Client,
    cluster_name: String,
    hosted_zone_id: String,
    dns_name: String,
}

impl ServiceDiscovery {
    pub async fn new(
        cluster_name: String,
        hosted_zone_id: String,
        dns_name: String,
    ) -> Result<Self, Box<dyn Error>> {
        let region_provider = RegionProviderChain::default_provider();
        let config = aws_config::defaults(BehaviorVersion::latest())
            .region(region_provider)
            .load()
            .await;

        let ecs_client = EcsClient::new(&config);
        let route53_client = Route53Client::new(&config);
        let ec2_client = aws_sdk_ec2::Client::new(&config);

        Ok(ServiceDiscovery {
            ecs_client,
            route53_client,
            ec2_client,
            cluster_name,
            hosted_zone_id,
            dns_name,
        })
    }
    /// Get the public IP address of this ECS task
    pub async fn get_public_ip(&self) -> Result<String, Box<dyn Error>> {
        // First, get the task ARN from the ECS metadata endpoint
        let task_metadata_uri = env::var("ECS_CONTAINER_METADATA_URI_V4")
            .map_err(|_| "ECS_CONTAINER_METADATA_URI_V4 not found. Are you running in ECS?")?;

        let task_metadata_url = format!("{task_metadata_uri}/task");
        let response = reqwest::get(&task_metadata_url).await?;
        let task_metadata: Value = response.json().await?;

        let task_arn = task_metadata["TaskARN"]
            .as_str()
            .ok_or("TaskARN not found in metadata")?;

        // Now describe the task to get network details
        let describe_tasks_output = self
            .ecs_client
            .describe_tasks()
            .cluster(&self.cluster_name)
            .tasks(task_arn)
            .send()
            .await?;

        let task = describe_tasks_output
            .tasks()
            .first()
            .ok_or("No tasks found")?;

        // For Fargate tasks, get the public IP from the ENI attachment
        let attachments = task.attachments();
        for attachment in attachments {
            if attachment.r#type() == Some("ElasticNetworkInterface") {
                for detail in attachment.details() {
                    if detail.name() == Some("networkInterfaceId")
                        && let Some(eni_id) = detail.value()
                    {
                        return self.get_eni_public_ip(eni_id).await;
                    }
                }
            }
        }

        Err("Could not find public IP for task".into())
    }

    /// Get the public IP of an ENI using EC2 API
    async fn get_eni_public_ip(&self, eni_id: &str) -> Result<String, Box<dyn Error>> {
        let describe_response = self
            .ec2_client
            .describe_network_interfaces()
            .network_interface_ids(eni_id)
            .send()
            .await?;

        let network_interface = describe_response
            .network_interfaces()
            .first()
            .ok_or("Network interface not found")?;

        let public_ip = network_interface
            .association()
            .and_then(|assoc| assoc.public_ip())
            .ok_or("No public IP found on network interface")?;

        Ok(public_ip.to_string())
    }
    /// Update Route53 DNS record with the current public IP
    pub async fn update_dns_record(&self, ip_address: &str) -> Result<(), Box<dyn Error>> {
        let resource_record = ResourceRecord::builder().value(ip_address).build()?;

        let resource_record_set = ResourceRecordSet::builder()
            .name(&self.dns_name)
            .r#type(RrType::A)
            .ttl(60) // 60 second TTL for quick updates
            .resource_records(resource_record)
            .build()?;

        let change = Change::builder()
            .action(ChangeAction::Upsert)
            .resource_record_set(resource_record_set)
            .build()?;

        let change_batch = aws_sdk_route53::types::ChangeBatch::builder()
            .changes(change)
            .build()?;

        let _change_response = self
            .route53_client
            .change_resource_record_sets()
            .hosted_zone_id(&self.hosted_zone_id)
            .change_batch(change_batch)
            .send()
            .await?;

        info!("DNS record updated successfully.",);

        Ok(())
    }

    /// Register this service on startup
    pub async fn register(&self) -> Result<(), Box<dyn Error>> {
        info!("Discovering public IP address...");
        let public_ip = self.get_public_ip().await?;
        info!("Found public IP: {public_ip}");

        info!("Updating DNS record...");
        self.update_dns_record(&public_ip).await?;
        info!("Service registered at {}", self.dns_name);

        Ok(())
    }
}

pub async fn shutdown_server() -> Result<()> {
    if !is_local() {
        warn!("I am shutting down the server. I mean it!");
        let region_provider = RegionProviderChain::default_provider();
        let config = aws_config::defaults(BehaviorVersion::latest())
            .region(region_provider)
            .load()
            .await;

        let ecs_client = EcsClient::new(&config);
        let retry_strategy = ExponentialBackoff::from_millis(1000).map(jitter).take(5);

        Retry::spawn(retry_strategy, || async {
            ecs_client
                .update_service()
                .cluster("TriviaWizardServer")
                .service("trivia-wizard-fargate-service")
                .desired_count(0)
                .send()
                .await
        })
        .await?;
    }
    Ok(())
}
