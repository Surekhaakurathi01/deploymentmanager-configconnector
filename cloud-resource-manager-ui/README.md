# Cloud Resource Manager UI

A functional React + Express interface for creating, viewing, refreshing, and deleting
Google Cloud Storage resources through either:

- Deployment Manager (`gcloud`)
- Config Connector (`kubectl`)

## Architecture

React UI -> Express backend -> gcloud / kubectl -> Google Cloud

## Important

The backend executes real cloud commands and can delete resources. Run it only in a
trusted/local Cloud Shell environment. Do not expose it publicly without authentication.

The backend uses the current gcloud authentication and kubectl context from the machine
where it is running.

## Prerequisites

- Google Cloud CLI (`gcloud`)
- kubectl
- Node.js 18+
- Config Connector installed and configured if using Config Connector
- A Google Cloud project with the required permissions

Example project:

    dm-cc-connector-1

Set the project:

    gcloud config set project dm-cc-connector-1

Check:

    gcloud config get-value project
    gcloud auth list
    kubectl get pods -A

## Run backend

Open a terminal in `backend`:

    npm install
    npm start

Backend runs on:

    http://localhost:5000

## Run frontend

Open another terminal in `frontend`:

    npm install
    npm run dev

Open the URL printed by Vite, normally:

    http://localhost:5173

## What the UI does

1. Select Deployment Manager or Config Connector.
2. Enter a valid globally-unique Cloud Storage bucket name.
3. Select a region.
4. Click Create Resource.
5. The backend executes the real command.
6. Click Refresh to retrieve current resources.
7. Delete from the UI only when you intentionally want to remove the resource.

## Cloud Shell note

If you run the backend in Google Cloud Shell, the frontend can also be run there.
For a simple demonstration, keep both processes in the same Cloud Shell environment and
use the Vite URL/preview mechanism provided by Cloud Shell.

## Config Connector

The backend creates a Kubernetes StorageBucket manifest containing:

    cnrm.cloud.google.com/project-id: <project>

and applies it with:

    kubectl apply -f <manifest>

This requires Config Connector to be healthy and the kubectl context to point to the
cluster where Config Connector is installed.

## Deployment Manager

The backend creates a temporary Deployment Manager YAML and runs:

    gcloud deployment-manager deployments create <deployment-name> --config <file>

Deployment Manager deployment names are generated from the bucket name plus a timestamp
to reduce collisions.

## Safety

Use test bucket names for the demo. Cloud Storage bucket names are globally unique.
Deletion is a real operation.
