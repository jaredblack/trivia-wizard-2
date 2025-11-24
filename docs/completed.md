# Completed Tasks

This document summarizes the completed tasks for the Trivia Wizard project.

## 1. Create Basic React Project

A basic React project was created using Vite and is located in the `frontend` directory. The project uses `react-router-dom` for routing and includes the following components:

-   `App.tsx`: The main application component that sets up routing.
-   `LandingPage.tsx`: The public landing page.
-   `HostLanding.tsx`: A protected page for hosts.
-   `ProtectedRoute.tsx`: A component to protect routes based on user authentication.

The frontend is configured to be deployed to an S3 bucket and served via CloudFront.

## 2. Create Basic Rust Server

A basic Rust server was created and is located in the `backend` directory. The server uses the following technologies:

-   **Axum**: For providing an HTTP health check endpoint.
-   **Tokio-tungstenite**: For the WebSocket server to handle game logic.
-   **Serde**: For JSON serialization and deserialization.

The server is designed to be run in a Docker container and deployed to AWS ECS Fargate.

## 3. Deploy React Project to S3 + CloudFront

The React frontend is deployed using AWS CDK. The `cdk/lib/HostingStack.ts` stack defines the following infrastructure:

-   **S3 Bucket**: An S3 bucket is created to store the static assets of the React application.
-   **CloudFront Distribution**: A CloudFront distribution is set up to serve the application from the S3 bucket, providing caching and HTTPS.
-   **Route 53 A Record**: An A record is created in a Route 53 hosted zone to point a custom domain (`trivia.jarbla.com`) to the CloudFront distribution.
-   **ACM Certificate**: An SSL/TLS certificate is created using AWS Certificate Manager and associated with the CloudFront distribution to enable HTTPS.

The static assets are deployed to the S3 bucket using the `s3deploy.BucketDeployment` construct.

## 4. Deploy Rust Server to ECS Fargate

The Rust backend is deployed to ECS Fargate using AWS CDK. The `cdk/lib/ServerStack.ts` stack defines the following infrastructure:

-   **ECS Fargate Cluster**: An ECS cluster named "TriviaWizardServer" is created to run the backend service.
-   **Docker Image**: The Rust server is built into a Docker image for the ARM64 architecture and pushed to an ECR repository.
-   **Fargate Task Definition**: A task definition is created with CPU and memory specifications, and a container definition for the backend service.
-   **ECS Fargate Service**: An ECS service is created to run the backend task. The service is configured with a desired count of 0, and it is set up to assign a public IP address to the task.
-   **IAM Role**: An IAM role is created for the ECS task, granting it permissions to update Route 53 records.

## 5. Implement Service Discovery using Route 53

Instead of using an SSM parameter, the backend server updates a Route 53 DNS record to make its IP address discoverable.

-   **Backend Logic**: The Rust server, upon startup in an ECS environment, determines its public IP address and updates a Route 53 A record (`ws.trivia.jarbla.com`) to point to itself.
-   **IAM Permissions**: The ECS task role is granted `route53:ChangeResourceRecordSets` and `route53:ListResourceRecordSets` permissions to allow it to update the DNS record.

## 6. Implement Authentication with Cognito

User authentication and authorization are handled by AWS Cognito. The `cdk/lib/AuthStack.ts` stack sets up the following:

-   **Cognito User Pool**: A user pool is created to manage user accounts.
-   **Cognito User Pool Client**: A user pool client is created for the frontend application to interact with the user pool.
-   **Cognito Identity Pool**: An identity pool is created to provide temporary AWS credentials to authenticated and unauthenticated users.
-   **IAM Roles**: An IAM role for hosts (`HostsRole`) is created with permissions to start the ECS service (`ecs:UpdateService`).
-   **Cognito Group**: A "Trivia-Hosts" group is created in the user pool, and the `HostsRole` is associated with this group. Users in this group have the necessary permissions to start the trivia server.

## 7. Implement Server Start Functionality

Authenticated users who are members of the "Trivia-Hosts" group can now start the trivia server directly from the web interface.

-   A "Start Server" button is displayed on the host landing page for authorized users.
-   Clicking this button triggers an update to the ECS service, starting the backend server task.
-   The UI provides a loading indicator while the server is starting up.
-   The frontend polls a health check endpoint on the backend to determine when the server is ready.
-   Once the server is running, a "Start Game" button appears, which initiates a WebSocket connection for gameplay.
-   The backend's health check endpoint now includes CORS headers to allow access from the frontend.

## 8. Implement Automatic Shutdown Timer

To reduce AWS costs, the backend server now automatically shuts itself down when no hosts are connected.

-   **ShutdownTimer Module**: A new `timer.rs` module implements a `ShutdownTimer` struct that manages automatic server shutdown after 30 minutes of inactivity.
-   **Timer Lifecycle**: The timer starts when all hosts disconnect from the server and is cancelled when a new WebSocket connection is established.
-   **ECS Integration**: The `shutdown_server()` function in `infra.rs` calls the ECS API to set the service's desired count to 0, effectively stopping the Fargate task.
-   **Graceful Shutdown**: The timer sends a shutdown signal that propagates through the application, allowing the main process to terminate cleanly.
-   **Retry Logic**: The ECS shutdown call uses exponential backoff with jitter to handle transient failures.
-   **Host Reconnection Support**: The `Game` model now supports hosts reconnecting to existing games via `set_host_tx` and `clear_host_tx` methods, allowing a host to reclaim their game session after a brief disconnection.
