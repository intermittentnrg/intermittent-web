locals {
  lambda_source_dir = abspath("${path.module}/../../tmp/lambda")
  lambda_zip_path   = abspath("${path.module}/../../tmp/lambda.zip")
}

data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = local.lambda_source_dir
  output_path = local.lambda_zip_path
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_exec" {
  name               = "${var.function_name}-exec"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = var.log_retention_in_days
}

data "aws_iam_policy_document" "lambda_logs" {
  statement {
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]

    resources = ["${aws_cloudwatch_log_group.lambda.arn}:*"]
  }
}

resource "aws_iam_role_policy" "lambda_logs" {
  name   = "${var.function_name}-logs"
  role   = aws_iam_role.lambda_exec.id
  policy = data.aws_iam_policy_document.lambda_logs.json
}

resource "aws_lambda_function" "web" {
  function_name = var.function_name
  role          = aws_iam_role.lambda_exec.arn

  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256

  runtime = "nodejs22.x"
  handler = "lambda.handler"

  memory_size = var.memory_size
  timeout     = var.timeout

  dynamic "environment" {
    for_each = length(var.environment_variables) > 0 ? [1] : []

    content {
      variables = merge({ NODE_OPTIONS = "--experimental-strip-types" }, var.environment_variables)
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy.lambda_logs,
  ]
}

resource "tls_private_key" "api_gateway_origin" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "tls_cert_request" "api_gateway_origin" {
  private_key_pem = tls_private_key.api_gateway_origin.private_key_pem

  subject {
    common_name  = "lambda.intermittent.energy"
    organization = "intermittent.energy"
  }

  dns_names = ["lambda.intermittent.energy"]
}

resource "cloudflare_origin_ca_certificate" "api_gateway" {
  csr                = tls_cert_request.api_gateway_origin.cert_request_pem
  hostnames          = ["lambda.intermittent.energy"]
  request_type       = "origin-rsa"
  requested_validity = 5475
}

resource "aws_acm_certificate" "api_gateway_origin" {
  private_key      = tls_private_key.api_gateway_origin.private_key_pem
  certificate_body = cloudflare_origin_ca_certificate.api_gateway.certificate
}

resource "aws_apigatewayv2_api" "web" {
  name          = var.function_name
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "web" {
  api_id                 = aws_apigatewayv2_api.web.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.web.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "web" {
  api_id    = aws_apigatewayv2_api.web.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.web.id}"
}

resource "aws_apigatewayv2_stage" "web" {
  api_id      = aws_apigatewayv2_api.web.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "allow_apigateway" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.web.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.web.execution_arn}/*/*"
}

resource "aws_apigatewayv2_domain_name" "web" {
  domain_name = "lambda.intermittent.energy"

  domain_name_configuration {
    certificate_arn = aws_acm_certificate.api_gateway_origin.arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "web" {
  api_id      = aws_apigatewayv2_api.web.id
  domain_name = aws_apigatewayv2_domain_name.web.id
  stage       = aws_apigatewayv2_stage.web.id
}

resource "cloudflare_dns_record" "lambda" {
  zone_id = "a4e4efd14989cfcf69416bfb4bfe2a6a"
  name    = "lambda.intermittent.energy"
  content = aws_apigatewayv2_domain_name.web.domain_name_configuration[0].target_domain_name
  type    = "CNAME"
  proxied = true
  ttl     = 1
}
