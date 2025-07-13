import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { IdentityPool, UserPoolAuthenticationProvider } from 'aws-cdk-lib/aws-cognito-identitypool';
import { Construct } from 'constructs';

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly identityPool: IdentityPool;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create Cognito User Pool
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'trivia-wizard-user-pool',
      
      signInAliases: {
        email: true,
      },
      
      selfSignUpEnabled: true,
      
      userVerification: {
        emailSubject: 'Verify your email for Trivia Wizard',
        emailBody: 'Hello, Your verification code is {####}',
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

    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: 'my-app-client',
      
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

    this.identityPool = new IdentityPool(this, 'IdentityPool', {
      identityPoolName: 'my-app-identity-pool',
      allowUnauthenticatedIdentities: false,
      authenticationProviders: {
        userPools: [
          new UserPoolAuthenticationProvider({
            userPool: this.userPool,
            userPoolClient: this.userPoolClient,
          }),
        ],
      },
    });

    // The L2 construct automatically creates and manages IAM roles
    // You can access them via:
    // - this.identityPool.authenticatedRole
    // - this.identityPool.unauthenticatedRole (if enabled)

    // Add additional permissions to the authenticated role if needed

    // Output important values
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: 'UserPoolId',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: 'UserPoolClientId',
    });

    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: this.identityPool.identityPoolId,
      description: 'Cognito Identity Pool ID',
      exportName: 'IdentityPoolId',
    });

    new cdk.CfnOutput(this, 'Region', {
      value: this.region,
      description: 'AWS Region',
      exportName: 'Region',
    });
  }
}