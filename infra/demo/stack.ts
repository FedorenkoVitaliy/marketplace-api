import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface BaseOutputs {
  vpcId: pulumi.Input<string>;
  publicSubnetIds: pulumi.Input<string>[];
  privateSubnetIds: pulumi.Input<string>[];
  edgeSgId: pulumi.Input<string>;
  appSgId: pulumi.Input<string>;
}

export interface DemoArgs {
  base: BaseOutputs;
  dbPassword: pulumi.Input<string>;
  withNat: boolean;
}

const HANDLER = `
exports.handler = async (event) => {
  const sick = process.env.HEALTHY === "false";
  const code = event.path === "/health" && sick ? 503 : 200;
  return {
    statusCode: code,
    statusDescription: code + " X",
    isBase64Encoded: false,
    headers: { "content-type": "text/plain" },
    body: code === 200 ? "ok\\n" : "draining\\n",
  };
};`;

export function createDemo(a: DemoArgs) {
  // Той самий guard, що в index.ts: у цьому файлі він стоїть вище за інстанс.
  pulumi.runtime.registerResourceTransform((args) =>
    args.type === "aws:rds/instance:Instance"
      ? { props: { ...args.props, deletionProtection: false, skipFinalSnapshot: true }, opts: args.opts }
      : undefined);

  const subnetGroup = new aws.rds.SubnetGroup("hw31-db-subnets", {
    subnetIds: a.base.privateSubnetIds,
  });
  const db = new aws.rds.Instance("hw31-db", {
    engine: "postgres",
    engineVersion: "16",
    instanceClass: "db.t4g.micro",
    allocatedStorage: 20,
    storageType: "gp3",
    storageEncrypted: true,
    multiAz: true,
    dbSubnetGroupName: subnetGroup.name,
    vpcSecurityGroupIds: [a.base.appSgId],
    publiclyAccessible: false,
    dbName: "app",
    username: "app",
    password: a.dbPassword,
    backupRetentionPeriod: 1,
    deletionProtection: false,
    skipFinalSnapshot: true,
    applyImmediately: true,
  });

  const role = new aws.iam.Role("hw31-target-role", {
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [{
        Effect: "Allow",
        Principal: { Service: "lambda.amazonaws.com" },
        Action: "sts:AssumeRole",
      }],
    }),
  });
  new aws.iam.RolePolicyAttachment("hw31-target-logs", {
    role: role.name,
    policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
  });
  const fn = new aws.lambda.Function("hw31-target", {
    runtime: "nodejs22.x",
    handler: "index.handler",
    role: role.arn,
    code: new pulumi.asset.AssetArchive({ "index.js": new pulumi.asset.StringAsset(HANDLER) }),
    environment: { variables: { HEALTHY: "true" } },
    timeout: 5,
    memorySize: 128,
  });
  const alb = new aws.lb.LoadBalancer("hw31-alb", {
    loadBalancerType: "application",
    internal: false,
    subnets: a.base.publicSubnetIds,
    securityGroups: [a.base.edgeSgId],
  });
  const tg = new aws.lb.TargetGroup("hw31-tg", {
    targetType: "lambda",
    healthCheck: {
      enabled: true,
      path: "/health",
      matcher: "200",
      interval: 35,
      timeout: 30,
      healthyThreshold: 2,
      unhealthyThreshold: 2,
    },
  });
  const perm = new aws.lambda.Permission("hw31-alb-invoke", {
    action: "lambda:InvokeFunction",
    function: fn.name,
    principal: "elasticloadbalancing.amazonaws.com",
    sourceArn: tg.arn,
  });
  new aws.lb.TargetGroupAttachment("hw31-tg-fn", {
    targetGroupArn: tg.arn,
    targetId: fn.arn,
  }, { dependsOn: [perm] });
  new aws.lb.Listener("hw31-http", {
    loadBalancerArn: alb.arn,
    port: 80,
    protocol: "HTTP",
    defaultActions: [{ type: "forward", targetGroupArn: tg.arn }],
  });

  let nat: aws.ec2.NatGateway | undefined;
  if (a.withNat) {
    const eip = new aws.ec2.Eip("hw31-nat-eip", { domain: "vpc" });
    nat = new aws.ec2.NatGateway("hw31-nat", {
      allocationId: eip.id,
      subnetId: a.base.publicSubnetIds[0],
    });
    // Приватна route table base не отримує 0.0.0.0/0 — ні на IGW, ні на цей NAT.
  }

  return { db, alb, tg, fn, nat };
}
