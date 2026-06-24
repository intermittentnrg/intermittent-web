# ------------------------------------------------------------------
# Preview environment outputs
# ------------------------------------------------------------------

output "preview_function_name" {
  description = "Preview Lambda function name."
  value       = module.preview.function_name
}

output "preview_api_gateway_endpoint" {
  description = "Preview HTTP API Gateway endpoint."
  value       = module.preview.api_gateway_endpoint
}

output "preview_custom_domain_name" {
  description = "Preview API Gateway custom domain name."
  value       = module.preview.custom_domain_name
}

output "preview_log_group_name" {
  description = "Preview CloudWatch log group name."
  value       = module.preview.log_group_name
}

# ------------------------------------------------------------------
# Production environment outputs
# ------------------------------------------------------------------

output "production_function_name" {
  description = "Production Lambda function name."
  value       = module.production.function_name
}

output "production_api_gateway_endpoint" {
  description = "Production HTTP API Gateway endpoint."
  value       = module.production.api_gateway_endpoint
}

output "production_custom_domain_name" {
  description = "Production API Gateway custom domain name."
  value       = module.production.custom_domain_name
}

output "production_log_group_name" {
  description = "Production CloudWatch log group name."
  value       = module.production.log_group_name
}
