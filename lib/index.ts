import {
  Choice,
  Condition,
  JsonPath,
  Map,
  Pass,
  StateMachine,
} from "aws-cdk-lib/aws-stepfunctions";
import {
  StepFunctionsStartExecution,
  StepFunctionsStartExecutionProps,
} from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";

export interface HandleOptionalParametersProps {
  requiredProperties: string[];
  optionalProperties: string[];
  // Data processing to be applied on each object input properties
  // Replace the name of the property to process by the string "value"
  // e.g. if you want to transform every values of an object input into a 1 value value array, you would write:
  // dataProcessing: "States.Array($.value)"
  dataProcessing: string;
}

export class HandleOptionalParameters extends StepFunctionsStartExecution {
  constructor(
    scope: Construct,
    id: string,
    props: Omit<StepFunctionsStartExecutionProps, "stateMachine"> &
      HandleOptionalParametersProps
  ) {
    const {
      requiredProperties,
      optionalProperties,
      dataProcessing,
      ...stepFunctionsStartExecutionProps
    } = props;

    // User input example:
    // {
    //   "requiredProperty": "bar",
    //   "optionalProperty1": 1
    // }

    // Generate an object with a unique id as value for each property.
    // Output:
    // {
    //   "placeholder": {
    //     "optionalProperty1": "a91a902e-fbd3-11ed-be56-0242ac120002",
    //     "optionalProperty2": "a91a902e-fbd3-11ed-be56-0242ac120002",
    //     "requiredProperty": "a91a902e-fbd3-11ed-be56-0242ac120002"
    //   },
    //   "input": {
    //     "requiredProperty": "bar",
    //     "optionalProperty1": 1
    //   }
    // }
    const generatePlaceholderTask = new Pass(scope, "Generate Placeholder", {
      parameters: {
        "input.$": "$",
        placeholder: [...requiredProperties, ...optionalProperties].reduce(
          (acc, propertyName) => ({
            [`${propertyName}.$`]: "States.UUID()",
            ...acc,
          }),
          {}
        ),
      },
    });

    // Merging the input with the generated object creates a new object with all properties defined.
    // This stops Step Functions from throwing "JsonPath argument not found" errors when attempting to process absent properties
    // Output:
    // {
    //   "output": {
    //     "optionalProperty1": 1,
    //     "optionalProperty2": "arn:aws:states:us-east-1:024892491262:execution:Processobjectinputvalues86B3DEAD-QXzljB0KFWJ3:26cec311-5d16-43dd-895f-2ee91efb2a2f",
    //     "requiredProperty": "bar"
    //   },
    //   "input": {
    //     "requiredProperty": "bar",
    //     "optionalProperty1": 1
    //   }
    // }
    const mergeWithPlaceholderValuesTask = new Pass(
      scope,
      "Merge with placeholder",
      {
        parameters: {
          "output.$": "States.JsonMerge($.placeholder, $.input, false)",
          "input.$": "$.input",
        },
      }
    );

    // We need to transform the object to an array to keep track of the property names.
    // Step Functions does not support (yet ?) JsonPath Plus operator "~".
    // Output:
    // {
    //   "transformedInput": [
    //     {
    //       "propertyName": "requiredProperty",
    //       "value": "bar"
    //     },
    //     {
    //       "propertyName": "optionalProperty1",
    //       "value": 1
    //     },
    //     {
    //       "propertyName": "optionalProperty2",
    //       "value": "arn:aws:states:us-east-1:024892491262:execution:Processobjectinputvalues86B3DEAD-QXzljB0KFWJ3:26cec311-5d16-43dd-895f-2ee91efb2a2f"
    //     }
    //   ],
    //   "input": {
    //     "requiredProperty": "bar",
    //     "optionalProperty1": 1
    //   }
    // }
    const optionalPropertiesAsArrayTask = new Pass(
      scope,
      "Optional properties as array",
      {
        parameters: {
          transformedInput: [...requiredProperties, ...optionalProperties].map(
            (propertyName) => ({
              "value.$": `$.output.${propertyName}`,
              propertyName,
            })
          ),
          "input.$": "$.input",
        },
      }
    );

    // Map over each { propertyName: string; value: any; } objects
    // Output:
    // {
    //   "notNullValues": [
    //     "\"requiredProperty\": [\"bar\"]",
    //     "\"optionalProperty1\": [1]",
    //     ""
    //   ],
    //   "allValues": [
    //     ",\"requiredProperty\": [\"bar\"]",
    //     ",\"optionalProperty1\": [1]",
    //     ""
    //   ]
    // }
    const mapTask = new Map(scope, "Map over all properties", {
      itemsPath: JsonPath.stringAt("$.transformedInput"),
      resultSelector: {
        "notNullValues.$": "$.[?(@.valueToConcat != ' ')].value",
        "allValues.$": "$.*.valueToConcat",
      },
    });

    // Assess if the value was present in the input
    const choiceTask = new Choice(scope, `Is value equal to uuid ?`);

    // Apply user input data processing to each value present in the user input.
    // This can be updated to apply advanced data processing, for example to apply a specific data processing depending on the property name.
    const processObjectValuesTask = new Pass(scope, `Process object values`, {
      parameters: {
        "value.$": dataProcessing,
        "propertyName.$": "$.propertyName",
      },
    });

    // Transform each value as an JSON string object to be later parsed and merged.
    const passValues = new Pass(scope, "Values", {
      parameters: {
        // eslint-disable-next-line no-useless-escape
        "valueToConcat.$": `States.Format(',\"{}\": {}', $.propertyName, States.JsonToString($.value))`,
        // eslint-disable-next-line no-useless-escape
        "value.$": `States.Format('\"{}\": {}', $.propertyName, States.JsonToString($.value))`,
      },
    });
    const passNullValues = new Pass(scope, "Null values", {
      parameters: { valueToConcat: "", separator: "", value: "" },
    });
    // Remove values absent from the user input.
    choiceTask
      .when(
        Condition.stringEqualsJsonPath("$.value", "$$.Execution.Id"),
        passNullValues
      )
      .otherwise(processObjectValuesTask.next(passValues));

    mapTask.iterator(choiceTask);

    const string = [...requiredProperties, ...optionalProperties].reduce(
      (currentString) => {
        return currentString.concat("{} ");
      },
      "States.Format(' "
    );

    const format = [...requiredProperties, ...optionalProperties].reduce(
      (currentString, _, index) => {
        return currentString.concat(`, $.allValues[${index}]`);
      },
      string.concat(" {} {} {}', '{', $.notNullValues[0]  ")
    );

    // Gather all key / values in a single string to be processed
    // Output:
    // {
    //   "object": " { \"requiredProperty\": [\"bar\"] ,\"requiredProperty\": [\"bar\"]  ,\"optionalProperty1\": [1]  }"
    // }
    const concatTask = new Pass(scope, "Concat", {
      parameters: {
        "object.$": format.concat(" , '}')"),
      },
    });

    // Transform to Json
    // Output: 🎉
    // {
    //   "requiredProperty": [
    //     "bar"
    //   ],
    //   "optionalProperty1": [
    //     1
    //   ]
    // }
    const toJsonTask = new Pass(scope, "ToJson", {
      parameters: {
        "object.$": "States.StringToJson($.object)",
      },
      outputPath: "$.object",
    });

    const stateMachine = new StateMachine(
      scope,
      "Process object input values",
      {
        definition: generatePlaceholderTask
          .next(mergeWithPlaceholderValuesTask)
          .next(optionalPropertiesAsArrayTask)
          .next(mapTask)
          .next(concatTask)
          .next(toJsonTask),
      }
    );

    super(scope, id, { ...stepFunctionsStartExecutionProps, stateMachine });
  }
}
