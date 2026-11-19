import * as aws from "@pulumi/aws";

export interface BaseArgs {
  budgetEmail: string;
  githubRepo: string;
  azs: [string, string];
  vpcCidr?: string;
}

export function createBase(a: BaseArgs) {
  const budget = new aws.budgets.Budget("hw31-budget", {
    budgetType: "COST",
    timeUnit: "MONTHLY",
    limitAmount: "5",
    limitUnit: "USD",
    notifications: [{
      notificationType: "ACTUAL",
      comparisonOperator: "GREATER_THAN",
      threshold: 20,
      thresholdType: "PERCENTAGE",
      subscriberEmailAddresses: [a.budgetEmail],
    }],
  });
  const cidr = a.vpcCidr ?? "10.31.0.0/16";
  const vpc = new aws.ec2.Vpc("hw31-vpc", {
    cidrBlock: cidr,
    enableDnsHostnames: true,
    enableDnsSupport: true,
  });
  const igw = new aws.ec2.InternetGateway("hw31-igw", { vpcId: vpc.id });

  const publicSubnets = a.azs.map((az, i) => new aws.ec2.Subnet(`hw31-public-${i}`, {
    vpcId: vpc.id,
    availabilityZone: az,
    cidrBlock: `10.31.${i}.0/24`,
    mapPublicIpOnLaunch: false,
    tags: { Tier: "public" },
  }));
  const privateSubnets = a.azs.map((az, i) => new aws.ec2.Subnet(`hw31-private-${i}`, {
    vpcId: vpc.id,
    availabilityZone: az,
    cidrBlock: `10.31.${10 + i}.0/24`,
    tags: { Tier: "private" },
  }));

  const publicRt = new aws.ec2.RouteTable("hw31-rt-public", {
    vpcId: vpc.id,
    routes: [{ cidrBlock: "0.0.0.0/0", gatewayId: igw.id }],
    tags: { Tier: "public" },
  });
  // Приватна таблиця без 0.0.0.0/0: у ній живе лише база, їй інтернет не потрібен.
  const privateRt = new aws.ec2.RouteTable("hw31-rt-private", {
    vpcId: vpc.id,
    routes: [],
    tags: { Tier: "private" },
  });
  publicSubnets.forEach((subnet, i) => new aws.ec2.RouteTableAssociation(`hw31-rta-public-${i}`, {
    subnetId: subnet.id,
    routeTableId: publicRt.id,
  }));
  privateSubnets.forEach((subnet, i) => new aws.ec2.RouteTableAssociation(`hw31-rta-private-${i}`, {
    subnetId: subnet.id,
    routeTableId: privateRt.id,
  }));

  const edgeSg = new aws.ec2.SecurityGroup("hw31-sg-edge", {
    vpcId: vpc.id,
    description: "Public entry for the load balancer",
    ingress: [
      // 80/tcp з інтернету: єдиний публічний HTTP-вхід. 443 не відкриваємо — домену і сертифіката немає.
      { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"], description: "HTTP to the load balancer" },
    ],
    egress: [
      // Вихід лише в CIDR VPC: балансувальник достукується до цілі і не ходить в інтернет.
      { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: [cidr], description: "targets inside the VPC" },
    ],
  });
  const appSg = new aws.ec2.SecurityGroup("hw31-sg-app", {
    vpcId: vpc.id,
    description: "Postgres only from the edge security group",
    ingress: [
      // 5432/tcp лише від edge SG: Postgres не приймає нічого з інтернету і з решти VPC.
      { protocol: "tcp", fromPort: 5432, toPort: 5432, securityGroups: [edgeSg.id], description: "Postgres from edge" },
    ],
    egress: [],
  });

  const oidc = new aws.iam.OpenIdConnectProvider("hw31-gh-oidc", {
    url: "https://token.actions.githubusercontent.com",
    clientIdLists: ["sts.amazonaws.com"],
  });
  const trust = oidc.arn.apply((arn) => JSON.stringify(ciTrust(arn, a.githubRepo)));
  const ciRole = new aws.iam.Role("hw31-ci-teardown", { assumeRolePolicy: trust });
  new aws.iam.RolePolicy("hw31-ci-teardown-policy", {
    role: ciRole.id,
    policy: JSON.stringify(teardownPolicy()),
  });

  return { budget, vpc, igw, publicSubnets, privateSubnets, publicRt, privateRt, edgeSg, appSg, oidc, ciRole };
}

export function ciTrust(oidcArn: string, githubRepo: string) {
  const [owner, name] = githubRepo.split("/");
  const subjects = [`repo:${githubRepo}:*`, `repo:${owner}@*/${name}@*:*`];
  return {
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { Federated: oidcArn },
      Action: "sts:AssumeRoleWithWebIdentity",
      Condition: {
        StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
        StringLike: { "token.actions.githubusercontent.com:sub": subjects },
      },
    }],
  };
}

// Resource "*" свідомо: ARN ресурсів demo ще невідомі, коли створюється base.
export function teardownPolicy() {
  const allow = (sid: string, actions: string[]) => ({
    Sid: sid,
    Effect: "Allow",
    Action: actions,
    Resource: "*",
  });
  return {
    Version: "2012-10-17",
    Statement: [
      allow("Rds", [
        "rds:DeleteDBInstance",
        "rds:DescribeDBInstances",
        "rds:DeleteDBSubnetGroup",
        "rds:DescribeDBSubnetGroups",
        "rds:ListTagsForResource",
      ]),
      allow("Elb", [
        "elasticloadbalancing:DeleteLoadBalancer",
        "elasticloadbalancing:DeleteListener",
        "elasticloadbalancing:DeleteTargetGroup",
        "elasticloadbalancing:DeregisterTargets",
        "elasticloadbalancing:DescribeLoadBalancers",
        "elasticloadbalancing:DescribeListeners",
        "elasticloadbalancing:DescribeTargetGroups",
        "elasticloadbalancing:DescribeTargetHealth",
        "elasticloadbalancing:DescribeLoadBalancerAttributes",
        "elasticloadbalancing:DescribeTargetGroupAttributes",
        "elasticloadbalancing:DescribeTags",
      ]),
      allow("NatAndAddresses", [
        "ec2:DeleteNatGateway",
        "ec2:DescribeNatGateways",
        "ec2:ReleaseAddress",
        "ec2:DisassociateAddress",
        "ec2:DescribeAddresses",
      ]),
      allow("Lambda", [
        "lambda:DeleteFunction",
        "lambda:GetFunction",
        "lambda:RemovePermission",
        "lambda:GetPolicy",
      ]),
      allow("IamDemoRole", [
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:DetachRolePolicy",
        "iam:ListAttachedRolePolicies",
        "iam:ListRolePolicies",
        "iam:DeleteRolePolicy",
        "iam:ListInstanceProfilesForRole",
      ]),
      allow("Audit", ["tag:GetResources", "sts:GetCallerIdentity"]),
    ],
  };
}
