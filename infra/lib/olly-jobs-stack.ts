import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as eventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as iam from "aws-cdk-lib/aws-iam";

export interface OllyJobsStackProps extends cdk.StackProps {
  lambda: {
    layers: {
      prismaLayerArn: string
    }
  }
};

export class OllyJobsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: OllyJobsStackProps) {
    super(scope, id, props);

    const deadLetterQueue = new sqs.Queue(this, "JobDeadLetterQueue", {
      queueName: `JobDeadLetterQueue`,
      retentionPeriod: cdk.Duration.days(14),
    });

    const jobQueue = new sqs.Queue(this, "JobQueue", {
      queueName: `JobQueue`,
      visibilityTimeout: cdk.Duration.minutes(5),
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 5,
      }
    });

    const runtimeLayerArn = props.lambda.layers.prismaLayerArn;

    const runtimeLayer = runtimeLayerArn
      ? lambda.LayerVersion.fromLayerVersionArn(
          this,
          "PrismaRuntimeLayer",
          runtimeLayerArn,
        )
      : undefined;

    const scheduler = new lambda.Function(this, "JobSchedulerLambda", {
      functionName: "JobScheduler",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      timeout: cdk.Duration.seconds(30),
      // Placeholder code; real handler code will be deployed separately via scripts.
      code: lambda.Code.fromInline(
        "exports.handler = async () => { console.log('JobScheduler placeholder'); };",
      ),
      environment: {
        JOB_QUEUE_URL: jobQueue.queueUrl,
        PRISMA_DATABASE_URL_PARAM: "/olly/prisma/databaseUrl",
        PRISMA_FIELD_ENCRYPTION_KEY_PARAM: "/olly/prisma/encryptionKey",
      },
      layers: runtimeLayer ? [runtimeLayer] : undefined,
    });

    const worker = new lambda.Function(this, "JobWorkerLambda", {
      functionName: "JobWorker",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      timeout: cdk.Duration.minutes(2),
      memorySize: 2048,
      code: lambda.Code.fromInline(
        "exports.handler = async () => { console.log('JobWorker placeholder'); };",
      ),
      environment: {
        JOB_QUEUE_URL: jobQueue.queueUrl,
        PRISMA_DATABASE_URL_PARAM: "/olly/prisma/databaseUrl",
        PRISMA_FIELD_ENCRYPTION_KEY_PARAM: "/olly/prisma/encryptionKey",
      },
      layers: runtimeLayer ? [runtimeLayer] : undefined,
    });

    jobQueue.grantSendMessages(scheduler);
    jobQueue.grantConsumeMessages(worker);

    // Allow Lambdas to read SSM parameters for secrets
    const ssmPolicy = new iam.PolicyStatement({
      actions: ["ssm:GetParameter"],
      resources: [
        `arn:aws:ssm:*:*:parameter/olly/prisma/databaseUrl`,
        `arn:aws:ssm:*:*:parameter/olly/prisma/encryptionKey`
      ],
    });
    const s3ListPolicy = new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      resources: [
        `"arn:aws:s3:::olly-debug-data"`
      ],
    });
    const s3ReadWritePolicy = new iam.PolicyStatement({
      actions: ["s3:*Object"],
      resources: [
        `"arn:aws:s3:::olly-debug-data/*"`
      ],
    });

    [ssmPolicy, s3ListPolicy, s3ReadWritePolicy].forEach((policy) => {
      scheduler.addToRolePolicy(policy);  
      worker.addToRolePolicy(policy);
    });    

    worker.addEventSource(
      new eventSources.SqsEventSource(jobQueue, {
        batchSize: 10,
      }),
    );

    new events.Rule(this, "EveryMinuteRule", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(scheduler)],
    });
  }
}
