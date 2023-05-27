import { App, Stack } from "aws-cdk-lib";
import {
  IntegrationPattern,
  StateMachine,
} from "aws-cdk-lib/aws-stepfunctions";

import { HandleOptionalParameters } from "../lib";

export class TestStack extends Stack {
  public stateMachineArn: string;

  constructor(scope: App, id: string) {
    super(scope, id);

    const processObjectValuesTask = new HandleOptionalParameters(
      scope,
      "Handle optional parameters",
      {
        integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
        requiredProperties: ["requiredProperty"],
        optionalProperties: ["optionalProperty1", "optionalProperty2"],
        dataProcessing: "States.Array($.value)",
      }
    );

    const { stateMachineArn } = new StateMachine(
      scope,
      "State machine using HandleOptionalParameters construct",
      {
        definition: processObjectValuesTask,
      }
    );

    this.stateMachineArn = stateMachineArn;
  }
}
