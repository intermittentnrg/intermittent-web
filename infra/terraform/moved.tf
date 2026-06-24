# ------------------------------------------------------------------
# moved blocks — automatically migrate existing root-level resources
# into the "preview" module.  No manual `terraform state mv` needed.
# ------------------------------------------------------------------

moved {
  from = data.aws_iam_policy_document.lambda_assume_role
  to   = module.preview.data.aws_iam_policy_document.lambda_assume_role
}

moved {
  from = data.aws_iam_policy_document.lambda_logs
  to   = module.preview.data.aws_iam_policy_document.lambda_logs
}

moved {
  from = aws_iam_role.lambda_exec
  to   = module.preview.aws_iam_role.lambda_exec
}

moved {
  from = aws_cloudwatch_log_group.lambda
  to   = module.preview.aws_cloudwatch_log_group.lambda
}

moved {
  from = aws_iam_role_policy.lambda_logs
  to   = module.preview.aws_iam_role_policy.lambda_logs
}

moved {
  from = aws_lambda_function.web
  to   = module.preview.aws_lambda_function.web
}

moved {
  from = tls_private_key.api_gateway_origin
  to   = module.preview.tls_private_key.api_gateway_origin
}

moved {
  from = tls_cert_request.api_gateway_origin
  to   = module.preview.tls_cert_request.api_gateway_origin
}

moved {
  from = cloudflare_origin_ca_certificate.api_gateway
  to   = module.preview.cloudflare_origin_ca_certificate.api_gateway
}

moved {
  from = aws_acm_certificate.api_gateway_origin
  to   = module.preview.aws_acm_certificate.api_gateway_origin
}

moved {
  from = aws_apigatewayv2_api.web
  to   = module.preview.aws_apigatewayv2_api.web
}

moved {
  from = aws_apigatewayv2_integration.web
  to   = module.preview.aws_apigatewayv2_integration.web
}

moved {
  from = aws_apigatewayv2_route.web
  to   = module.preview.aws_apigatewayv2_route.web
}

moved {
  from = aws_apigatewayv2_stage.web
  to   = module.preview.aws_apigatewayv2_stage.web
}

moved {
  from = aws_lambda_permission.allow_apigateway
  to   = module.preview.aws_lambda_permission.allow_apigateway
}

moved {
  from = aws_apigatewayv2_domain_name.web
  to   = module.preview.aws_apigatewayv2_domain_name.web
}

moved {
  from = aws_apigatewayv2_api_mapping.web
  to   = module.preview.aws_apigatewayv2_api_mapping.web
}

moved {
  from = cloudflare_dns_record.lambda
  to   = module.preview.cloudflare_dns_record.lambda
}
