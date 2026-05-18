output "function_name" {
  description = "Lambda function name."
  value       = aws_lambda_function.web.function_name
}

output "function_url" {
  description = "Public Lambda Function URL."
  value       = aws_lambda_function_url.web.function_url
}

output "log_group_name" {
  description = "CloudWatch log group name."
  value       = aws_cloudwatch_log_group.lambda.name
}
