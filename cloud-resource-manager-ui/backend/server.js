const express = require("express");
const cors = require("cors");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 8,
      ...options
    }, (error, stdout, stderr) => {
      if (error) {
        const e = new Error(stderr || stdout || error.message);
        e.stdout = stdout;
        e.stderr = stderr;
        e.code = error.code;
        reject(e);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function validBucketName(name) {
  return typeof name === "string" &&
    name.length >= 3 &&
    name.length <= 63 &&
    /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(name) &&
    !name.includes("..");
}

function validRegion(region) {
  return typeof region === "string" && /^[a-z0-9-]+$/.test(region);
}

function safeDeploymentName(bucketName) {
  const suffix = Date.now().toString(36);
  let value = `${bucketName}-dm-${suffix}`.toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return value.slice(0, 63).replace(/-$/, "");
}

function friendlyCommandError(method, error) {
  const message = `${error.stderr || ""}\n${error.stdout || ""}\n${error.message || ""}`.toLowerCase();

  if (error.code === "ENOENT" || message.includes("spawn gcloud enoent")) {
    return "Google Cloud CLI (gcloud) is not installed or is not on PATH. Install it, run gcloud auth login, and set the active project.";
  }

  if (method === "Config Connector" &&
      (message.includes("current-context is not set") ||
       message.includes("no context exists") ||
       message.includes("couldn't get current server api group list") ||
       message.includes("server could not find the requested resource"))) {
    return "Config Connector is unavailable: kubectl has no active Kubernetes cluster context. Configure kubectl for a cluster with Config Connector installed.";
  }

  return error.stderr || error.stdout || error.message || "The cloud command failed.";
}

async function getProject(requestedProject) {
  if (requestedProject && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(requestedProject)) {
    return requestedProject;
  }
  const result = await run("gcloud", ["config", "get-value", "project"]);
  const project = result.stdout.trim();
  if (!project) throw new Error("No active gcloud project. Run: gcloud config set project PROJECT_ID");
  return project;
}

app.get("/api/health", async (req, res) => {
  try {
    const project = await getProject(req.query.project);
    res.json({ ok: true, project });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/resources", async (req, res) => {
  const project = await getProject(req.query.project);
  const resources = [];
  const errors = [];

  try {
    const dm = await run("gcloud", [
      "deployment-manager", "deployments", "list",
      "--project", project,
      "--format=json"
    ]);
    const deployments = JSON.parse(dm.stdout || "[]");
    for (const d of deployments) {
      resources.push({
        method: "Deployment Manager",
        type: "Deployment",
        name: d.name,
        status: d.state || "UNKNOWN",
        detail: d.description || "Deployment Manager deployment",
        bucket: ""
      });
    }
  } catch (e) {
    errors.push(`Deployment Manager: ${friendlyCommandError("Deployment Manager", e)}`);
  }

  try {
    const cc = await run("kubectl", [
      "get", "storagebucket",
      "-A",
      "-o", "json"
    ]);
    const data = JSON.parse(cc.stdout || '{"items":[]}');
    for (const item of data.items || []) {
      const name = item.metadata?.name || "unknown";
      const ns = item.metadata?.namespace || "default";
      const ready = (item.status?.conditions || []).find(c => c.type === "Ready");
      resources.push({
        method: "Config Connector",
        type: "StorageBucket",
        name,
        namespace: ns,
        status: ready ? `${ready.status} / ${ready.reason || ""}`.trim() : "UNKNOWN",
        detail: ready?.message || item.status?.url || "Kubernetes StorageBucket",
        bucket: item.status?.url || `gs://${name}`
      });
    }
  } catch (e) {
    errors.push(`Config Connector: ${friendlyCommandError("Config Connector", e)}`);
  }

  res.json({ project, resources, errors });
});

app.post("/api/resources/create", async (req, res) => {
  const { method, bucketName, region, project: requestedProject } = req.body || {};

  if (!validBucketName(bucketName)) {
    return res.status(400).json({
      error: "Invalid bucket name. Use 3-63 lowercase letters, numbers, dots, underscores or hyphens; start and end with a letter or number."
    });
  }
  if (!validRegion(region)) {
    return res.status(400).json({ error: "Invalid region." });
  }

  try {
    const project = await getProject(requestedProject);

    if (method === "Config Connector") {
      const yaml = `apiVersion: storage.cnrm.cloud.google.com/v1beta1
kind: StorageBucket
metadata:
  name: ${bucketName}
  namespace: default
  annotations:
    cnrm.cloud.google.com/project-id: ${project}
spec:
  location: ${region}
`;
      const file = path.join(os.tmpdir(), `${bucketName}-${crypto.randomUUID()}.yaml`);
      fs.writeFileSync(file, yaml);
      try {
        const result = await run("kubectl", ["apply", "-f", file]);
        return res.json({
          ok: true,
          method,
          project,
          resource: bucketName,
          command: `kubectl apply -f ${file}`,
          output: result.stdout + result.stderr
        });
      } finally {
        try { fs.unlinkSync(file); } catch (_) {}
      }
    }

    if (method === "Deployment Manager") {
      const deploymentName = safeDeploymentName(bucketName);
      const yaml = `resources:
- name: ${bucketName}
  type: storage.v1.bucket
  properties:
    name: ${bucketName}
    location: ${region}
    project: ${project}
`;
      const file = path.join(os.tmpdir(), `${deploymentName}.yaml`);
      fs.writeFileSync(file, yaml);
      try {
        const result = await run("gcloud", [
          "deployment-manager", "deployments", "create", deploymentName,
          "--project", project,
          "--config", file
        ]);
        return res.json({
          ok: true,
          method,
          project,
          resource: deploymentName,
          bucket: bucketName,
          command: `gcloud deployment-manager deployments create ${deploymentName} --project ${project} --config ${file}`,
          output: result.stdout + result.stderr
        });
      } finally {
        try { fs.unlinkSync(file); } catch (_) {}
      }
    }

    return res.status(400).json({ error: "Method must be Deployment Manager or Config Connector." });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: friendlyCommandError(method, error),
      output: error.stdout || ""
    });
  }
});

app.post("/api/resources/delete", async (req, res) => {
  const { method, name, project: requestedProject, namespace } = req.body || {};
  if (!name) return res.status(400).json({ error: "Resource name is required." });

  try {
    const project = await getProject(requestedProject);

    if (method === "Config Connector") {
      const args = ["delete", "storagebucket", name, "-n", namespace || "default", "--ignore-not-found"];
      const result = await run("kubectl", args);
      return res.json({
        ok: true,
        method,
        project,
        resource: name,
        command: `kubectl ${args.join(" ")}`,
        output: result.stdout + result.stderr
      });
    }

    if (method === "Deployment Manager") {
      const args = [
        "deployment-manager", "deployments", "delete", name,
        "--project", project,
        "--quiet"
      ];
      const result = await run("gcloud", args);
      return res.json({
        ok: true,
        method,
        project,
        resource: name,
        command: `gcloud ${args.join(" ")}`,
        output: result.stdout + result.stderr
      });
    }

    return res.status(400).json({ error: "Unsupported method." });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: friendlyCommandError(method, error),
      output: error.stdout || ""
    });
  }
});

app.listen(PORT, () => {
  console.log(`Cloud Resource Manager backend running on http://localhost:${PORT}`);
});
