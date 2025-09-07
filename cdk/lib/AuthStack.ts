import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import {
  IdentityPool,
  IdentityPoolProviderUrl,
  RoleMappingMatchType,
  UserPoolAuthenticationProvider,
} from "aws-cdk-lib/aws-cognito-identitypool";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import { ServerStack } from "./ServerStack";

interface AuthStackProps extends cdk.StackProps {
  serverStack: ServerStack;
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly identityPool: IdentityPool;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    // Create Cognito User Pool
    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "trivia-wizard-user-pool",
      signInAliases: {
        email: true,
      },
      selfSignUpEnabled: true,
      userVerification: {
        emailSubject: "Verify your email for Trivia Wizard",
        emailBody: "Hello, Your verification code is {####}",
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ai giving me the runaround tonight
    // but looks like I can make the role attachment directly on the L2 construct
    // will try that

    this.userPoolClient = new cognito.UserPoolClient(this, "UserPoolClient", {
      userPool: this.userPool,
      userPoolClientName: "trivia-wizard-client",
      authFlows: {
        userSrp: true,
        userPassword: true,
      },
      generateSecret: false,
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    const hostsRole = new iam.Role(this, "HostsRole", {
      assumedBy: new iam.FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: {
            "cognito-identity.amazonaws.com:aud": "placeholder",
          },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
    });

    this.identityPool = new IdentityPool(this, "IdentityPool", {
      identityPoolName: "trivia-wizard-identity-pool",
      allowUnauthenticatedIdentities: true,
      authenticationProviders: {
        userPools: [
          new UserPoolAuthenticationProvider({
            userPool: this.userPool,
            userPoolClient: this.userPoolClient,
          }),
        ],
      },
      roleMappings: [
        {
          providerUrl: IdentityPoolProviderUrl.userPool(
            this.userPool,
            this.userPoolClient
          ),
          mappingKey: "trivia-hosts-key",
          useToken: false,
          resolveAmbiguousRoles: true,
          rules: [
            {
              claim: "cognito:groups",
              matchType: RoleMappingMatchType.CONTAINS,
              claimValue: "Trivia-Hosts",
              mappedRole: hostsRole,
            },
          ],
        },
      ],
    });

    // Update the hostsRole trust policy with the actual Identity Pool ID
    hostsRole.assumeRolePolicy?.addStatements(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [
          new iam.FederatedPrincipal("cognito-identity.amazonaws.com"),
        ],
        actions: ["sts:AssumeRoleWithWebIdentity"],
        conditions: {
          StringEquals: {
            "cognito-identity.amazonaws.com:aud":
              this.identityPool.identityPoolId,
          },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "authenticated",
          },
        },
      })
    );

    // Add ECS permissions to hosts role
    hostsRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecs:UpdateService", "ecs:DescribeServices"],
        resources: [props.serverStack.service.serviceArn],
      })
    );

    // Create hosts group and attach the role
    new cognito.CfnUserPoolGroup(this, "HostsGroup", {
      userPoolId: this.userPool.userPoolId,
      groupName: "Trivia-Hosts",
      description: "Users who can host trivia games",
    });

    // Output important values
    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
      description: "Cognito User Pool ID",
      exportName: "UserPoolId",
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
      description: "Cognito User Pool Client ID",
      exportName: "UserPoolClientId",
    });

    new cdk.CfnOutput(this, "IdentityPoolId", {
      value: this.identityPool.identityPoolId,
      description: "Cognito Identity Pool ID",
      exportName: "IdentityPoolId",
    });

    new cdk.CfnOutput(this, "Region", {
      value: this.region,
      description: "AWS Region",
      exportName: "Region",
    });
  }
}
