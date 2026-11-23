import * as pulumi from "@pulumi/pulumi";
import { createBase } from "./stack";

// Дефолтний провайдер читає LocalStack :23166, skip* і ключі test/test з Pulumi.base.yaml.
// Окремий aws.Provider не створюємо: перший ресурс програми — бюджет.
const cfg = new pulumi.Config("hw31");
const base = createBase({
  budgetEmail: cfg.require("budgetEmail"),
  githubRepo: cfg.require("githubRepo"),
  azs: cfg.requireObject<[string, string]>("azs"),
});

export const vpcId = base.vpc.id;
export const publicSubnetIds = base.publicSubnets.map((subnet) => subnet.id);
export const privateSubnetIds = base.privateSubnets.map((subnet) => subnet.id);
export const edgeSgId = base.edgeSg.id;
export const appSgId = base.appSg.id;
export const privateRouteTableId = base.privateRt.id;
export const ciRoleArn = base.ciRole.arn;
export const budgetName = base.budget.name;
