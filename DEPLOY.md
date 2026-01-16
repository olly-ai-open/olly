
## Deploying web app

Pushing `main` on github will automatically trigger the app deployment on Vercel.

### Environment Variables
The webapp is setup to read the environment variables from [Vercel's environment variables](https://vercel.com/<org>/<project>/settings/environment-variables). These environment variables are only read once per deployment.

## Deploying AWS Lambda functions
### Prerequisites
* Get AWS credentials and activate them in your environment.
* Install `awscli` via the instructions from [here](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html).

### Environment Variables
The Lambda functions are setup to read environment variables from AWS SSM. To add/modify environment variables, go to https://000000000000-tv6ivtpd.us-west-2.console.aws.amazon.com/systems-manager/parameters?region=us-west-2#. Whenever a Lambda function has a cold start, that's when it would be reading the environment variables from SSM. We do not control when a Lambda function is started from a cold start. To force this, a deployment should be done. 

### Deploying Worker Lambda

Build:

     $ cd infra
     $ ./scripts/build-worker-lambda.sh

Deploy:

     $ cd infra
     $ aws lambda update-function-code --region us-west-2 --function-name JobWorker --zip-file fileb://<project_dir>/dist-lambda/worker.zip

### Deploying Scheduler Lambda

Build:

     $ cd infra
     $ ./scripts/build-scheduler-lambda.sh

Deploy:

     $ cd infra
     $ aws lambda update-function-code --region us-west-2 --function-name JobScheduler --zip-file fileb://<project_dir>/dist-lambda/scheduler.zip

## AWS Lambda Layer updates
The lambda functions make use of an AWS Lambda layer to package the prisma dependencies. So, when the schema is updated, the prisma layer needs to be updated.

Build:

      $ cd infra
      $ ./scripts/build-prisma-layer.sh

Deploy:

      $ cd infra
      $ aws lambda publish-layer-version --region us-west-2 --layer-name OllyPrismaDeps --zip-file fileb://<project_dir>/dist-lambda/prisma-layer.zip --compatible-runtimes nodejs22.x

### NOTE
After the Lambda layer is updated, make sure to update the version of the layer being used for the above mentioned AWS lambdas. That part is not automated yet.


   
