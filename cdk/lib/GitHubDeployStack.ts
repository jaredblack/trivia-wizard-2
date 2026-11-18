import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";

const GITHUB_REPO = "jaredblack/trivia-wizard-2";
const DEPLOY_BRANCH = "main";

/**
 * Lets GitHub Actions deploy the app stacks via OIDC (no long-lived keys).
 *
 * Deployed manually, once: `npx cdk deploy TriviaAppGitHubDeployStack`.
 * The CI workflow deploys only the app stacks, never this one, so CI can't
 * widen its own permissions.
 */
export class GitHubDeployStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const provider = new iam.OidcProviderNative(this, "GitHubOidcProvider", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });

    const role = new iam.Role(this, "GitHubDeployRole", {
      roleName: "trivia-wizard-github-deploy",
      maxSessionDuration: cdk.Duration.hours(2),
      assumedBy: new iam.WebIdentityPrincipal(provider.oidcProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": `repo:${GITHUB_REPO}:ref:refs/heads/${DEPLOY_BRANCH}`,
        },
      }),
    });

    // CDK does the real work through its bootstrap roles (deploy, file/image
    // publishing, lookup), so assuming those is all this role needs.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`],
      })
    );

    new cdk.CfnOutput(this, "DeployRoleArn", {
      value: role.roleArn,
      description: "Set as the AWS_DEPLOY_ROLE_ARN GitHub Actions variable",
    });
  }
}
