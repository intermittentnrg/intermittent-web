variable "function_name" {
  description = "Lambda function name."
  type        = string
  default     = "intermittent-web"
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

variable "cloudflare_api_token" {}
