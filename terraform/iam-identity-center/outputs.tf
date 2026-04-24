output "identity_center_instance_arn" {
  value = local.instance_arn
}

output "identity_store_id" {
  value = local.identity_store_id
}

output "dev_power_user_permission_set_arn" {
  value = aws_ssoadmin_permission_set.dev_power_user.arn
}

output "security_audit_permission_set_arn" {
  value = aws_ssoadmin_permission_set.security_audit.arn
}

output "contractor_read_only_permission_set_arn" {
  value = aws_ssoadmin_permission_set.contractor_read_only.arn
}
