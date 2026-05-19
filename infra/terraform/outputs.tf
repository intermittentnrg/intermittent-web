output "function_name" {
  description = "Lambda function name."
  value       = aws_lambda_function.web.function_name
}

output "api_gateway_endpoint" {
  description = "Default HTTP API Gateway endpoint."
  value       = aws_apigatewayv2_api.web.api_endpoint
}

output "custom_domain_name" {
  description = "API Gateway custom domain name."
  value       = aws_apigatewayv2_domain_name.web.domain_name
}

output "log_group_name" {
  description = "CloudWatch log group name."
  value       = aws_cloudwatch_log_group.lambda.name
}
