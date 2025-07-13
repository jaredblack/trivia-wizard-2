# Basic Hosting and Authentication Plan

This document outlines the steps to set up static hosting for the React application using AWS S3 and CloudFront, and to implement user authentication with AWS Cognito. The infrastructure will be managed using the AWS CDK.

## [COMPLETE] 1. AWS CDK Setup

- **Initialize CDK Project:**
    - Create a new directory `cdk` in the project root.
    - Inside `cdk`, initialize a new CDK project using TypeScript: `cdk init app --language typescript`.
    - This will create the necessary files and folder structure for a CDK application.

- **Install Dependencies:**
    - In the `cdk` directory, install the AWS CDK library:
      ```bash
      npm install aws-cdk-lib constructs
      ```

- **Create CDK Stacks:**
    - Define two stacks in the `cdk/lib` directory:
        - `HostingStack.ts`: For S3 and CloudFront resources.
        - `AuthStack.ts`: For Cognito User Pool and User Pool Client.
    - The main CDK app file (`cdk/bin/cdk.ts`) will instantiate these stacks.

## [COMPLETE] 2. S3 + CloudFront Hosting

- **S3 Bucket:**
    - In `HostingStack.ts`, define an S3 bucket to store the React app's static files (`index.html`, CSS, JS).
    - Configure the bucket for website hosting.

- **CloudFront Distribution:**
    - Create a CloudFront distribution that points to the S3 bucket as its origin.
    - Configure the distribution to serve `index.html` for all requests to handle client-side routing.
    - Set up an Origin Access Control (OAC) to restrict direct access to the S3 bucket, allowing access only through CloudFront.

- **Deployment:**
    - Use the `s3deploy.BucketDeployment` construct in `aws-cdk-lib/aws-s3-deployment` to automatically upload the React app's build output (from `frontend/dist`) to the S3 bucket during `cdk deploy`.

## 3. Cognito Authentication in React

- **Cognito User Pool:**
    - In `AuthStack.ts`, create a Cognito User Pool to manage users.
    - Configure the user pool with desired sign-in options (e.g., email, username) and password policies.

- **Cognito User Pool Client:**
    - Create a User Pool Client. This client will be used by the React app to interact with the User Pool.
    - The CDK stack will output the User Pool ID and User Pool Client ID, which are needed for the React app configuration.

- **React App Integration:**
    - Install the AWS Amplify library for authentication in the `frontend` directory:
      ```bash
      npm install aws-amplify
      ```
    - In the React app (`frontend/src/main.tsx` or `frontend/src/App.tsx`), configure Amplify with the Cognito User Pool ID and Client ID from the CDK stack outputs.
    - Create React components for:
        - Sign-up
        - Sign-in
        - Sign-out
    - Use Amplify's functions (`signUp`, `signIn`, `signOut` from `aws-amplify/auth`) to handle the authentication logic.
    - Protect routes in the React app so that only authenticated users can access them.

## Deployment Workflow

1.  **Build the React App:**
    - Run `npm run build` in the `frontend` directory.
2.  **Deploy CDK Stacks:**
    - Run `cdk deploy --all` from the `cdk` directory. This will create the AWS resources and upload the frontend build artifacts to S3.
3.  **Access the App:**
    - The CloudFront distribution URL will be available in the CDK stack outputs. Access this URL in a browser to use the application.
