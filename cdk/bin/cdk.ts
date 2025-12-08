#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { HostingStack } from '../lib/HostingStack';
import { AuthStack } from '../lib/AuthStack';
import { ServerStack } from '../lib/ServerStack';

const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  };

const app = new cdk.App();

const authStack = new AuthStack(app, 'TriviaAppAuthStack', { env });

new ServerStack(app, 'TriviaAppServerStack', {
  env: env,
  authStack: authStack,
});

new HostingStack(app, 'TriviaAppHostingStack', {
  env: env,
});
