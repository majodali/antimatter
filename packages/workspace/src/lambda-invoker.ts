/**
 * Adapter that wraps @aws-sdk/client-lambda into the LambdaInvoker interface
 * used by CommandLambdaEnvironment.
 *
 * Kept separate so the CommandLambdaEnvironment itself only depends on the
 * thin LambdaInvoker interface — tests can provide a mock without importing
 * the AWS SDK.
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { LambdaInvoker } from './command-lambda-environment.js';

export class AwsLambdaInvoker implements LambdaInvoker {
  private readonly client: LambdaClient;

  constructor(client?: LambdaClient) {
    this.client = client ?? new LambdaClient({});
  }

  async invoke(functionName: string, payload: unknown): Promise<{
    statusCode?: number;
    functionError?: string;
    payload: string;
  }> {
    const response = await this.client.send(
      new InvokeCommand({
        FunctionName: functionName,
        Payload: new TextEncoder().encode(JSON.stringify(payload)),
      }),
    );

    const responsePayload = response.Payload
      ? new TextDecoder().decode(response.Payload)
      : '{}';

    return {
      statusCode: response.StatusCode,
      functionError: response.FunctionError,
      payload: responsePayload,
    };
  }
}
