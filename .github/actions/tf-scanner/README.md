# Terraform Resource Scanner

![GitHub Action](https://img.shields.io/badge/GitHub%20Action-Terraform%20Scanner-blue?logo=githubactions)

## Description

This GitHub Action recursively scans a Terraform directory, parses all `.tf` files using regex, and returns a JSON output containing every `module` block (with its name and source) and every `resource` block (with its Terraform type and a human-readable service name derived from that type). For example, `aws_s3_bucket` becomes `"S3 Bucket"` and `aws_iam_role` becomes `"IAM Role"`.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `terraform_dir` | No | `terraform` | Path to the Terraform directory to scan, relative to the repo root. |

## Outputs

| Output | Description |
|---|---|
| `result` | JSON string containing `modules` (array of `{ name, source }`) and `resources` (array of `{ type, service }`). |

## Example Workflow

```yaml
name: Terraform Scan

on:
  pull_request:
    paths:
      - "terraform/**"

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Scan Terraform
        id: tf_scan
        uses: ./.github/actions/tf-scanner
        with:
          terraform_dir: "terraform"

      - name: Print result
        run: echo '${{ steps.tf_scan.outputs.result }}'

      - name: Use result in subsequent step
        run: |
          echo '${{ steps.tf_scan.outputs.result }}' | jq '.resources[] | .service'
```

## Output Shape

```json
{
  "modules": [
    { "name": "vpc", "source": "terraform-aws-modules/vpc/aws" }
  ],
  "resources": [
    { "type": "aws_s3_bucket", "service": "S3 Bucket" },
    { "type": "aws_iam_role", "service": "IAM Role" },
    { "type": "google_storage_bucket", "service": "Storage Bucket" },
    { "type": "azurerm_virtual_network", "service": "Virtual Network" }
  ]
}
```

## Service Name Derivation

The `service` value is derived from the Terraform resource type by splitting the type string on `_` and dropping the first segment, which represents the cloud provider prefix (e.g., `aws`, `google`, `azurerm`). The remaining segments are title-cased and joined with spaces. For example, `aws_s3_bucket` becomes `"S3 Bucket"` and `azurerm_virtual_network` becomes `"Virtual Network"`.

## Notes / Limitations

- Only `.tf` files are parsed; `.tfvars` and `.tfstate` files are ignored.
- Source values are extracted from double-quoted strings only; heredoc-style sources are not supported.
- Duplicate module `name`+`source` pairs across multiple files are deduplicated in the output.
