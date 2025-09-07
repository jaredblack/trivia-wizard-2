import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
import { fetchAuthSession } from 'aws-amplify/auth';

// TODO: Replace with your actual values.
// You can find these values in the output of the `cdk deploy` command
// or in the AWS Console for your Cognito User Pool and Identity Pool.
const IDENTITY_POOL_ID = "us-east-1:c74bd2ea-8672-4242-ba1d-92d42cbb6482";
const USER_POOL_ID = "us-east-1_AWbZedeID";
const REGION = "us-east-1";

export const getCredentials = async () => {
  const session = await fetchAuthSession();;
  const credentials = fromCognitoIdentityPool({
    client: new CognitoIdentityClient({ region: REGION }),
    identityPoolId: IDENTITY_POOL_ID,
    logins: {
      [`cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`]: session.tokens!.idToken!.toString(),
    },
  });

  return credentials();
};
