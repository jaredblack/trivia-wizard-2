import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { DockerImageAsset } from "aws-cdk-lib/aws-ecr-assets";
import * as path from "path";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";

export class ServerStack extends cdk.Stack {
  public readonly service: ecs.FargateService;
  public readonly taskRole: iam.Role;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, "DefaultVPC", {
      isDefault: true,
    });

    const cluster = new ecs.Cluster(this, "TriviaWizardServer", {
      vpc: vpc,
      clusterName: "TriviaWizardServer",
    });

    const logGroup = new logs.LogGroup(this, "TriviaLogGroup", {
      logGroupName: "/aws/ecs/trivia-wizard",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.taskRole = new iam.Role(this, "TriviaTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    this.taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ecs:DescribeTasks",
          "ec2:DescribeNetworkInterfaces",
          "route53:ChangeResourceRecordSets",
          "route53:ListResourceRecordSets",
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
      serviceName: "trivia-wizard-fargate-service",
    });

    this.service.connections.allowFromAnyIpv4(
      ec2.Port.tcp(9002),
      "Allow WebSocket connections"
    );

    this.service.connections.allowFromAnyIpv4(
      ec2.Port.tcp(8080),
      "Allow health check"
    );

    new cdk.CfnOutput(this, "ServiceArn", {
      value: this.service.serviceArn,
      description: "The ARN of the ECS service",
    });

    new cdk.CfnOutput(this, "ClusterName", {
      value: cluster.clusterName,
      description: "The name of the ECS cluster",
    });
  }
}
