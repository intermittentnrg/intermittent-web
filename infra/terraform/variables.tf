# ------------------------------------------------------------------
# Global / shared variables
# ------------------------------------------------------------------

variable "cloudflare_api_token" {
  description = "Cloudflare API token."
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for DNS records."
  type        = string
  default     = "a4e4efd14989cfcf69416bfb4bfe2a6a"
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
  description = "Environment variables to set on both Lambda functions."
  type        = map(string)
  default     = {}
  sensitive   = true
}

# ------------------------------------------------------------------
# Preview environment
# ------------------------------------------------------------------

variable "preview_function_name" {
  description = "Lambda function name for the preview environment."
  type        = string
  default     = "intermittent-web"
}

variable "preview_domain_name" {
  description = "Custom domain name for the preview environment."
  type        = string
  default     = "preview.intermittent.energy"
}

# ------------------------------------------------------------------
# Production environment
# ------------------------------------------------------------------

variable "production_function_name" {
  description = "Lambda function name for the production environment."
  type        = string
  default     = "intermittent-web-prod"
}

variable "production_domain_name" {
  description = "Custom domain name for the production environment."
  type        = string
  default     = "intermittent.energy"
}
