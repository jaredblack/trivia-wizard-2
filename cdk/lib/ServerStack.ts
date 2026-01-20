import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { DockerImageAsset } from "aws-cdk-lib/aws-ecr-assets";
import * as path from "path";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import { AuthStack } from "./AuthStack";
import { ECS_CLUSTER_NAME, ECS_SERVICE_NAME } from "./constants";

interface ServerStackProps extends cdk.StackProps {
  authStack: AuthStack;
}

export class ServerStack extends cdk.Stack {
  public readonly service: ecs.FargateService;
  public readonly taskRole: iam.Role;

  constructor(scope: Construct, id: string, props: ServerStackProps) {
    super(scope, id, props);

    const hostedZoneId = "Z02007853E9RZODID8U1C";

    const vpc = ec2.Vpc.fromLookup(this, "DefaultVPC", {
      isDefault: true,
    });

    const cluster = new ecs.Cluster(this, "TriviaWizardServer", {
      vpc: vpc,
      clusterName: ECS_CLUSTER_NAME,
    });

    const logGroup = new logs.LogGroup(this, "TriviaLogGroup", {
      logGroupName: "/aws/ecs/trivia-wizard",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // S3 bucket for game state persistence
    const gameStatesBucket = new s3.Bucket(this, "GameStatesBucket", {
      bucketName: "trivia-wizard-game-states",
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(365),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.taskRole = new iam.Role(this, "TriviaTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    // Grant S3 read/write access for game state persistence
    gameStatesBucket.grantReadWrite(this.taskRole);

    this.taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ecs:DescribeTasks",
          "ec2:DescribeNetworkInterfaces",
          "route53:ChangeResourceRecordSets",
          "route53:ListResourceRecordSets",
          "ecs:UpdateService",
        ],
        resources: ["*"],
      })
    );

    const image = new DockerImageAsset(this, "TriviaWizardBackendImage", {
      directory: path.join(__dirname, "../../backend"),
      platform: cdk.aws_ecr_assets.Platform.LINUX_ARM64,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "TriviaTaskDef",
      {
        memoryLimitMiB: 512,
        cpu: 256,
        taskRole: this.taskRole,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      }
    );

    taskDefinition.addContainer("TriviaBackendContainer", {
      image: ecs.ContainerImage.fromDockerImageAsset(image),
      portMappings: [{ containerPort: 9002 }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "trivia-backend",
        logGroup: logGroup,
      }),
      environment: {
        AWS_REGION: this.region,
        COGNITO_USER_POOL_ID: props.authStack.userPool.userPoolId,
        COGNITO_CLIENT_ID: props.authStack.userPoolClient.userPoolClientId,
        ROUTE53_HOSTED_ZONE_ID: hostedZoneId,
        S3_BUCKET_NAME: gameStatesBucket.bucketName,
      },
      healthCheck: {
        command: [
          "CMD-SHELL",
          "curl -f http://localhost:8080/health || exit 1",
        ],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    this.service = new ecs.FargateService(this, "TriviaService", {
      cluster: cluster,
      taskDefinition: taskDefinition,
      desiredCount: 0,
      assignPublicIp: true,
      serviceName: ECS_SERVICE_NAME,
    });

    this.service.connections.allowFromAnyIpv4(
      ec2.Port.tcp(9002),
      "Allow WebSocket connections"
    );

    this.service.connections.allowFromAnyIpv4(
      ec2.Port.tcp(8080),
      "Allow health check"
    );

    // Hosted zone for trivia.jarbla.com
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      "TriviaHostedZone",
      {
        hostedZoneId: hostedZoneId,
        zoneName: "trivia.jarbla.com",
      }
    );

    // ACM Certificate for CloudFront (must be in us-east-1)
    const certificate = new acm.Certificate(this, "WsCertificate", {
      domainName: "ws.trivia.jarbla.com",
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // CloudFront distribution for WebSocket and HTTPS
    const distribution = new cloudfront.Distribution(this, "WsDistribution", {
      defaultBehavior: {
        origin: new origins.HttpOrigin("ws-origin.trivia.jarbla.com", {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          httpPort: 9002,
        }),
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy:
          cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
      additionalBehaviors: {
        "/health": {
          origin: new origins.HttpOrigin("ws-origin.trivia.jarbla.com", {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
            httpPort: 8080,
          }),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
      },
      domainNames: ["ws.trivia.jarbla.com"],
      certificate: certificate,
    });

    // Route53 A record pointing to CloudFront
    new route53.ARecord(this, "WsAliasRecord", {
      zone: hostedZone,
      recordName: "ws",
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(distribution)
      ),
    });

    new cdk.CfnOutput(this, "ServiceArn", {
      value: this.service.serviceArn,
      description: "The ARN of the ECS service",
    });

    new cdk.CfnOutput(this, "ClusterName", {
      value: cluster.clusterName,
      description: "The name of the ECS cluster",
    });

    new cdk.CfnOutput(this, "CloudFrontDomain", {
      value: distribution.distributionDomainName,
      description: "CloudFront distribution domain",
    });

    new cdk.CfnOutput(this, "CustomDomain", {
      value: "https://ws.trivia.jarbla.com",
      description: "Custom domain for WebSocket/HTTPS access",
    });
  }
}
