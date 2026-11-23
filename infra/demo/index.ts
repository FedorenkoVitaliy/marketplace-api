import * as pulumi from "@pulumi/pulumi";
import { createDemo } from "./stack";

// До будь-якого ресурсу: забутий deletionProtection або фінальний снапшот переживає destroy.
pulumi.runtime.registerResourceTransform((args) =>
  args.type === "aws:rds/instance:Instance"
    ? { props: { ...args.props, deletionProtection: false, skipFinalSnapshot: true }, opts: args.opts }
    : undefined);

const cfg = new pulumi.Config("hw31");
const ref = new pulumi.StackReference(cfg.require("baseStackRef"));
const subnetAt = (key: string, index: number) =>
  ref.requireOutput(key).apply((ids) => (ids as string[])[index]);

const demo = createDemo({
  base: {
    vpcId: ref.requireOutput("vpcId"),
    publicSubnetIds: [0, 1].map((index) => subnetAt("publicSubnetIds", index)),
    privateSubnetIds: [0, 1].map((index) => subnetAt("privateSubnetIds", index)),
    edgeSgId: ref.requireOutput("edgeSgId"),
    appSgId: ref.requireOutput("appSgId"),
  },
  dbPassword: cfg.get("dbPassword") ?? "local-only",
  withNat: cfg.getBoolean("withNat") ?? false,
});

export const vpcId = ref.requireOutput("vpcId");
export const dbIdentifier = demo.db.identifier;
export const dbAz = demo.db.availabilityZone;
export const albDns = demo.alb.dnsName;
export const targetGroupArn = demo.tg.arn;
export const natGatewayId = demo.nat?.id;
