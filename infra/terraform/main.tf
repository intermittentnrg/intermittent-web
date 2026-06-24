locals {
  lambda_source_dir = abspath("${path.module}/../../tmp/lambda")
  lambda_zip_path   = abspath("${path.module}/../../tmp/lambda.zip")
}

data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = local.lambda_source_dir
  output_path = local.lambda_zip_path
}

# ------------------------------------------------------------------
# Preview environment (existing — migrated from root-level resources)
# ------------------------------------------------------------------
module "preview" {
  source = "./modules/lambda-web"

  function_name           = var.preview_function_name
  domain_name             = var.preview_domain_name
  memory_size             = var.memory_size
  timeout                 = var.timeout
  log_retention_in_days   = var.log_retention_in_days
  environment_variables   = var.environment_variables
  lambda_zip_path         = data.archive_file.lambda.output_path
  lambda_source_code_hash = data.archive_file.lambda.output_base64sha256
  cloudflare_zone_id      = var.cloudflare_zone_id
}

# ------------------------------------------------------------------
# Production environment
# ------------------------------------------------------------------
module "production" {
  source = "./modules/lambda-web"

  function_name           = var.production_function_name
  domain_name             = var.production_domain_name
  memory_size             = var.memory_size
  timeout                 = var.timeout
  log_retention_in_days   = var.log_retention_in_days
  environment_variables   = var.environment_variables
  lambda_zip_path         = data.archive_file.lambda.output_path
  lambda_source_code_hash = data.archive_file.lambda.output_base64sha256
  cloudflare_zone_id      = var.cloudflare_zone_id
}
