import * as k8s from "@pulumi/kubernetes";

const required = [
  "APP_DB_PASSWORD",
  "PULUMI_CONFIG_PASSPHRASE",
  "PACT_BROKER_URL",
  "PACT_BROKER_TOKEN",
  "JWT_PRIVATE_KEY",
  "JWT_PUBLIC_KEY",
  "JWT_KID",
  "REFRESH_TOKEN_PEPPER",
  "STORAGE_ENDPOINT",
  "STORAGE_ACCESS_KEY",
  "STORAGE_SECRET_KEY",
  "STORAGE_BUCKET",
] as const;

for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`${name} is required`);
  }
}

const password = process.env.APP_DB_PASSWORD ?? "";
const rev = process.env.REV ?? "1";
const name = "api";
const labels = { app: name };

const provider = new k8s.Provider("hw28", { context: "kind-hw28" });
const opts = { provider };

new k8s.core.v1.Namespace(name, { metadata: { name: "marketplace" } }, opts);

const secret = new k8s.core.v1.Secret(name, {
  metadata: { name: "app-db", namespace: "marketplace" },
  data: {
    APP_DB_PASSWORD: Buffer.from(password, "utf8").toString("base64"),
  },
}, opts);

new k8s.apps.v1.Deployment(name, {
  metadata: { name, namespace: "marketplace", labels },
  spec: {
    replicas: 2,
    selector: { matchLabels: labels },
    strategy: {
      type: "RollingUpdate",
      rollingUpdate: { maxUnavailable: 0, maxSurge: 1 },
    },
    template: {
      metadata: { labels },
      spec: {
        terminationGracePeriodSeconds: 30,
        securityContext: { runAsNonRoot: true, runAsUser: 65532, runAsGroup: 65532 },
        containers: [{
          name: "api",
          image: "marketplace-api:hw28",
          imagePullPolicy: "IfNotPresent",
          ports: [{ containerPort: 8080 }],
          env: [
            { name: "PORT", value: "8080" },
            { name: "WARMUP_MS", value: "4000" },
            { name: "DRAIN_MS", value: "8000" },
            { name: "REV", value: rev },
            {
              name: "APP_DB_PASSWORD",
              valueFrom: { secretKeyRef: { name: secret.metadata.name, key: "APP_DB_PASSWORD" } },
            },
          ],
          resources: {
            requests: { cpu: "20m", memory: "64Mi" },
            limits: { memory: "128Mi" },
          },
          startupProbe: {
            httpGet: { path: "/healthz", port: 8080 },
            periodSeconds: 1,
            failureThreshold: 20,
            timeoutSeconds: 1,
          },
          readinessProbe: {
            httpGet: { path: "/readyz", port: 8080 },
            periodSeconds: 1,
            failureThreshold: 1,
            timeoutSeconds: 1,
          },
          livenessProbe: {
            httpGet: { path: "/healthz", port: 8080 },
            periodSeconds: 10,
            failureThreshold: 3,
            timeoutSeconds: 1,
          },
        }],
      },
    },
  },
}, opts);

new k8s.core.v1.Service(name, {
  metadata: { name, namespace: "marketplace", labels },
  spec: {
    type: "NodePort",
    selector: labels,
    ports: [{ port: 80, targetPort: 8080, nodePort: 30980 }],
  },
}, opts);

new k8s.policy.v1.PodDisruptionBudget(name, {
  metadata: { name, namespace: "marketplace", labels },
  spec: { minAvailable: 1, selector: { matchLabels: labels } },
}, opts);

new k8s.autoscaling.v2.HorizontalPodAutoscaler(name, {
  metadata: { name, namespace: "marketplace", labels },
  spec: {
    scaleTargetRef: { apiVersion: "apps/v1", kind: "Deployment", name },
    minReplicas: 2,
    maxReplicas: 4,
    metrics: [{
      type: "Resource",
      resource: {
        name: "cpu",
        target: { type: "Utilization", averageUtilization: 70 },
      },
    }],
  },
}, opts);
