import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";
import { ECSClient, UpdateServiceCommand } from "@aws-sdk/client-ecs";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
import { fetchAuthSession } from "aws-amplify/auth";

const IDENTITY_POOL_ID = "us-east-1:c74bd2ea-8672-4242-ba1d-92d42cbb6482";
const USER_POOL_ID = "us-east-1_AWbZedeID";
const REGION = "us-east-1";

export const getCredentials = async () => {
  const session = await fetchAuthSession();
  const credentials = fromCognitoIdentityPool({
    client: new CognitoIdentityClient({ region: REGION }),
    identityPoolId: IDENTITY_POOL_ID,
    logins: {
      [`cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`]:
        session.tokens!.idToken!.toString(),
    },
  });

  return credentials();
};

export const startServer = async () => {
  const credentials = await getCredentials();
  const ecsClient = new ECSClient({ credentials, region: "us-east-1" });
  const command = new UpdateServiceCommand({
    cluster: "TriviaWizardServer",
    service: "trivia-wizard-fargate-service",
    desiredCount: 1,
  });
  await ecsClient.send(command);
};
