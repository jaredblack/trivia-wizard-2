# CDK Context - Trivia Wizard

This document provides context about the AWS CDK infrastructure for future Claude sessions.

## Technology Stack

- **CDK Version:** AWS CDK 2
- **Language:** TypeScript
- **Region:** us-east-1
- **Account:** 623560468325

## Project Structure

```
cdk/
├── bin/
│   └── cdk.ts              # Entry point, instantiates all stacks
├── lib/
│   ├── AuthStack.ts        # Cognito authentication
│   ├── ServerStack.ts      # ECS backend + WebSocket CDN
│   ├── HostingStack.ts     # Frontend S3 + CDN
│   └── constants.ts        # Shared constants (cluster/service names)
├── cdk.json                # CDK configuration
├── cdk.context.json        # Cached context (VPC, hosted zones)
├── package.json
└── tsconfig.json
```

## Stack Architecture

Three separate stacks with dependencies:

```
TriviaAppAuthStack (independent)
        ↓ exports UserPoolId, ClientId, IdentityPoolId
TriviaAppServerStack (depends on AuthStack)

TriviaAppHostingStack (independent)
```

## TriviaAppAuthStack

Creates Cognito authentication infrastructure.

### Resources

**User Pool:** `trivia-wizard-user-pool`
- Sign-in: Email-based
- Self-registration: Enabled
- Password: 8+ characters (no complexity requirements)
- Verification: 6-digit email code
- Tokens: 1 hour (access/ID), 30 days (refresh)

**User Pool Client:** `trivia-wizard-client`
- Public client (no secret)
- Auth flows: SRP + Password
- Prevents user enumeration

**Identity Pool:** `trivia-wizard-identity-pool`
- Allows unauthenticated identities
- Role mapping based on Cognito groups

**User Group:** `Trivia-Hosts`
- Members get ECS service update permissions
- Mapped to HostsRole via Identity Pool rules

### IAM Roles

- **HostsRole:** ECS UpdateService/DescribeServices on trivia service
- **IdentityPoolAuthenticatedRole:** Default authenticated access
- **IdentityPoolUnauthenticatedRole:** Guest access

### Exports

- `UserPoolId`
- `UserPoolClientId`
- `IdentityPoolId`

## TriviaAppServerStack

Creates ECS backend and WebSocket CDN. Depends on AuthStack.

### ECS Configuration

**Cluster:** `TriviaWizardServer`
- Uses default VPC

**Task Definition (Fargate):**
- CPU: 256 (0.25 vCPU)
- Memory: 512 MB
- Platform: ARM64 (Graviton, cost-optimized)
- Container ports: 9002 (WebSocket), 8080 (health)

**Service:** `trivia-wizard-fargate-service`
- Desired count: 0 (manual scaling, on-demand startup)
- Public IP: Enabled
- Deployment: Max 200%, Min 50%

**Container Environment Variables:**
- `AWS_REGION`: us-east-1
- `COGNITO_USER_POOL_ID`: From AuthStack
- `COGNITO_CLIENT_ID`: From AuthStack
- `ROUTE53_HOSTED_ZONE_ID`: Z02007853E9RZODID8U1C
- `S3_BUCKET_NAME`: trivia-wizard-game-states

**Security Group:**
- Ingress: TCP 9002, TCP 8080 from 0.0.0.0/0
- Egress: All traffic

**Task Role Permissions:**
- S3: Read/write on game-states bucket
- ECS: Describe tasks, update service
- EC2: Describe network interfaces
- Route53: Manage record sets

### S3 Storage

**Bucket:** `trivia-wizard-game-states`
- Purpose: Persist game state
- Lifecycle: Auto-expire after 365 days
- Removal: RETAIN (preserved on stack deletion)
- Access: Private

### CloudFront (WebSocket)

- Domain: ws.trivia.jarbla.com
- Origin: HTTP to ws-origin.trivia.jarbla.com:9002
- Cache: Disabled (real-time WebSocket)
- Behaviors:
  - Default: All HTTP methods
  - /health: GET/HEAD only

### Route53

- A record: ws.trivia.jarbla.com → CloudFront

### CloudWatch Logs

- Log group: `/aws/ecs/trivia-wizard`
- Retention: 7 days

## TriviaAppHostingStack

Creates frontend static hosting. Independent stack.

### S3 Bucket

- Purpose: Frontend assets from `../frontend/dist`
- Removal: DESTROY (cleaned up on stack deletion)
- Access: Private, CloudFront via OAC

### CloudFront (Frontend)

- Domain: trivia.jarbla.com
- Origin: S3 bucket via Origin Access Control
- Default root: index.html
- Error handling: 403/404 → index.html (SPA routing)
- Cache: Managed Caching Optimized policy

### Route53

- A record: trivia.jarbla.com → CloudFront

### Deployment

- S3BucketDeployment deploys `../frontend/dist` to bucket
- Invalidates CloudFront cache on deployment

## Networking

**VPC:** Default VPC (vpc-0e08dfa660691b953)
- CIDR: 172.31.0.0/16
- Public subnets in 6 AZs (us-east-1a through 1f)

**DNS:**
- Hosted zone: jarbla.com (Z02007853E9RZODID8U1C)
- trivia.jarbla.com → Frontend CloudFront
- ws.trivia.jarbla.com → WebSocket CloudFront

**Certificates:**
- ACM certificates for both domains
- DNS validation via Route53

## Key Architectural Decisions

1. **ARM64 compute** - Graviton2 for cost optimization
2. **Manual ECS scaling** - DesiredCount=0, started on-demand by host users
3. **Default VPC** - Simplifies deployment
4. **Group-based access** - Trivia-Hosts group for elevated permissions
5. **SPA routing** - 404/403 errors redirect to index.html
6. **No WebSocket caching** - Ensures real-time communication
7. **RETAIN game state bucket** - Preserves data on stack deletion
8. **DESTROY frontend bucket** - Clean deletion
9. **OAC for S3** - Modern CloudFront-to-S3 access pattern

## Deployment

```bash
# Build TypeScript
npm run build

# Synthesize CloudFormation
npx cdk synth

# Deploy all stacks
npx cdk deploy --all

# Deploy specific stack
npx cdk deploy TriviaAppAuthStack

# Show changes
npx cdk diff
```

**Deployment Order:**
1. TriviaAppAuthStack (first, creates Cognito)
2. TriviaAppServerStack (needs Auth exports)
3. TriviaAppHostingStack (can parallel with Server)

## Constants (lib/constants.ts)

```typescript
export const ECS_CLUSTER_NAME = "TriviaWizardServer"
export const ECS_SERVICE_NAME = "trivia-wizard-fargate-service"
```

Used by both CDK and frontend for ECS service management.

## Important Identifiers

| Resource | Value |
|----------|-------|
| Account | 623560468325 |
| Region | us-east-1 |
| Hosted Zone ID | Z02007853E9RZODID8U1C |
| ECS Cluster | TriviaWizardServer |
| ECS Service | trivia-wizard-fargate-service |
| Game State Bucket | trivia-wizard-game-states |
| Frontend Domain | trivia.jarbla.com |
| WebSocket Domain | ws.trivia.jarbla.com |
