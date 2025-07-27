# Trivia Server Deployment Plan

## Container & Image Management

1. **Build Rust server into container** - Standard Dockerfile
2. **Publish to ECR** - CDK can create the ECR repository
3. **Image deployment** - Use CDK's `DockerImageAsset` construct to build and push automatically during deployment

## Infrastructure (CDK)

4. **ECS Cluster** - Fargate cluster definition
5. **Task Definition** - Container specs, CPU/memory, environment variables
6. **ECS Service** - Initially set `desiredCount: 0`
7. **VPC/Networking** - Subnets, security groups for WebSocket traffic
8. **Parameter Store parameter** - Create a parameter (e.g., `/trivia/websocket-endpoint`) for storing the WebSocket URL

## Permissions & Auth

9. **IAM Role for ECS Task** - So your Rust server can:

   - Call ECS APIs to shut itself down
   - Write to Parameter Store (`ssm:PutParameter`)

10. **Cognito User Group** - Create a "Trivia-Hosts" group in your Cognito User Pool

11. **IAM Role for Hosts Group** - Create a separate IAM role with permissions:

- `ecs:UpdateService` on your specific ECS service
- `ecs:DescribeServices` (to check service status)
- Attach this role to the "Trivia-Hosts" group

12. **IAM Role for Regular Users** - Default Cognito identity pool role with minimal permissions:

- `ssm:GetParameter` on the WebSocket endpoint parameter (read-only)
- No ECS permissions

13. **Public Parameter Store access** - Configure the parameter to be readable without authentication (`ssm:GetParameter`)

## Rust Server Updates

14. **Startup logic** - On startup, write WebSocket endpoint to Parameter Store
15. **Connection monitoring** - Track WebSocket connections and idle timeout
16. **Shutdown logic** - Update ECS service desired count to 0, then exit gracefully
17. **Cleanup** - Clear Parameter Store parameter on shutdown (optional)

## Frontend Integration

18. **AWS SDK integration** - Add ECS client (host only) and SSM client (both host and players)
19. **Service discovery function** - `getWebSocketUrl()` that reads from Parameter Store
20. **Host flow** - Update ECS service, wait for Parameter Store to populate, then connect
21. **Player flow** - Read Parameter Store, connect to WebSocket with game code
22. **Error handling** - What happens if Parameter Store is empty (server not running)
23. **Permission-based UI** - Show/hide "Start Server" button based on group membership

## Additional Considerations

24. **CloudWatch Logs** - For debugging your Rust server
25. **Health checks** - ECS health check configuration
26. **Parameter Store cleanup** - Handle cases where server crashes without cleanup

## CDK Implementation Notes

- Use `CfnUserPoolGroup` to create the group
- Create two separate IAM roles: one for hosts, one for regular authenticated users
- Use role mapping in your Cognito Identity Pool to assign roles based on group membership

## Manual Process
1. User signs up → gets regular user permissions (can read Parameter Store only)
2. You manually add trusted users to "Trivia-Hosts" group in Cognito console
3. Those users now see the start server functionality

## Key Flow

1. Host calls ECS `UpdateService` (desiredCount: 1)
2. Rust server starts, writes `ws://{task-ip}:8080` to Parameter Store
3. Both host and players call `getWebSocketUrl()` → read from Parameter Store
4. Everyone connects to same WebSocket endpoint
5. Host creates game, shares game code with players
6. Players join game using game code
