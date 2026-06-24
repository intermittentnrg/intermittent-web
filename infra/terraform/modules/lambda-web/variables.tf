variable "function_name" {
  description = "Lambda function name."
  type        = string
}

variable "domain_name" {
  description = "Custom domain name for the API Gateway."
  type        = string
}

variable "memory_size" {
  description = "Lambda memory size in MB."
  type        = number
  default     = 256
}

variable "timeout" {
  description = "Lambda timeout in seconds."
  type        = number
  default     = 60
}

variable "log_retention_in_days" {
  description = "CloudWatch log retention for the Lambda log group."
  type        = number
  default     = 14
}

variable "environment_variables" {
  description = "Environment variables to set on the Lambda function."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "lambda_zip_path" {
  description = "Path to the pre-built Lambda zip file."
  type        = string
}

variable "lambda_source_code_hash" {
  description = "Base64-encoded SHA256 hash of the Lambda zip."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for DNS records."
  type        = string
}
