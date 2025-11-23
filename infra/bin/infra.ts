#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { OllyJobsStack } from "../lib/olly-jobs-stack";

const app = new cdk.App();

new OllyJobsStack(app, "OllyJobsStack", {
  env: {
    region: 'us-west-2',
    account: '000000000000',
  },
  lambda: {
    layers: {
      prismaLayerArn: 'arn:aws:lambda:us-west-2:000000000000:layer:OllyPrismaDeps:3'
    }
  },
});


