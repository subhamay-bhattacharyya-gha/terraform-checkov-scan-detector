# Claude Code Prompt: Terraform Resource Scanner — GitHub Custom Action

## Goal

Generate a complete, production-ready **GitHub composite/JavaScript custom action** that:

1. Recursively scans a Terraform directory (default: `./terraform`, configurable via input).
2. Parses all `.tf` files to extract:
   - **Modules** — every `module` block, capturing the module name and its `source` value.
   - **Resources** — every `resource` block, capturing the resource type and resource name.
3. Outputs a single JSON string with two top-level keys:

```json
{
  "modules": [
    { "name": "vpc", "source": "terraform-aws-modules/vpc/aws" }
  ],
  "resources": [
    { "type": "aws_s3_bucket", "service": "S3" }
  ]
}
```

---

## Deliverables

Generate **all** of the following files:

```text
.github/
└── actions/
    └── tf-scanner/
        ├── action.yml          # Action metadata & interface
        ├── index.js            # Core Node.js logic
        ├── package.json        # Node dependencies
        └── README.md           # Usage documentation
```

---

## Detailed Specifications

### `action.yml`

- **name**: `Terraform Resource Scanner`
- **description**: Scans Terraform files and outputs a JSON summary of modules and resources.
- **inputs**:
  - `terraform_dir` — Directory to scan. Default: `"terraform"`.
- **outputs**:
  - `result` — JSON string with `modules` and `resources` arrays.
- **runs**: Use `using: node20` with `main: index.js`.

### `index.js`

Requirements:

- Use only **Node.js built-in modules** (`fs`, `path`, `@actions/core`) — no external HCL parser.
- Implement a **regex-based parser** that handles real-world `.tf` file patterns.
- Recursively walk the target directory using `fs.readdirSync` + recursion (no `glob` dependency).
- For **modules**: match blocks of the form:

  ```hcl
  module "name" {
    source = "some/source"
  }
  ```

  Regex hint: `module\s+"([^"]+)"\s*\{[^}]*source\s*=\s*"([^"]+)"`  (use `dotAll` flag).
- For **resources**: match blocks of the form:

  ```hcl
  resource "aws_s3_bucket" "my_bucket" {
  ```

  Regex hint: `resource\s+"([^"]+)"\s+"([^"]+)"\s*\{`
- For each resource, derive a human-readable **service name** from the resource type string:
  - Split the type on `_`, drop the cloud-provider prefix (first segment, e.g. `aws`, `google`, `azurerm`), then title-case the remaining segments and join with a space.
  - Examples: `aws_s3_bucket` → `"S3 Bucket"`, `aws_iam_role` → `"IAM Role"`, `google_storage_bucket` → `"Storage Bucket"`, `azurerm_virtual_network` → `"Virtual Network"`.
  - Store this value under the key **`service`** (not `name`) in the output object.
- Deduplicate results — if the same module name+source pair appears in multiple files, include it only once.
- Set the action output via `core.setOutput("result", JSON.stringify(output))`.
- Also print the JSON to `core.info()` for log visibility.
- On error, call `core.setFailed(error.message)`.

### `package.json`

- `name`: `tf-scanner`
- `version`: `1.0.0`
- `main`: `index.js`
- Dependencies: `"@actions/core": "^1.10.0"`
- Include a `build` script: `"build": "ncc build index.js -o dist"` (for bundling if needed).

### `README.md`

Include:

- A one-paragraph description.
- **Inputs** table (name, required, default, description).
- **Outputs** table (name, description).
- A complete example workflow:

```yaml
- name: Scan Terraform
  id: tf_scan
  uses: ./.github/actions/tf-scanner
  with:
    terraform_dir: "terraform"

- name: Print result
  run: echo '${{ steps.tf_scan.outputs.result }}'
```

- A sample output JSON block.

---

## Constraints & Quality Rules

1. **No external HCL parser** — regex only, to keep the action dependency-free and fast.
2. The regex must tolerate:
   - Single-line and multi-line blocks.
   - Extra whitespace and blank lines inside blocks.
   - Both `"` and heredoc-style sources (best-effort; double-quoted strings are required).
3. Skip files/directories that are not `.tf` (e.g., `.tfvars`, `.tfstate`).
4. The output JSON must be **valid** — always serialize with `JSON.stringify`.
5. Never throw on a missing directory — instead call `core.setFailed` with a clear message like `"Directory not found: terraform"`.
6. The action must work with `actions/checkout@v4` as the only prerequisite step.

---

## Example Input Structure

Assume this Terraform layout when testing mentally:

```text
terraform/
├── main.tf
├── variables.tf
├── modules/
│   └── networking/
│       └── main.tf
└── environments/
    └── prod/
        └── main.tf
```

**terraform/main.tf** might contain:

```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.1.0"
}

resource "aws_s3_bucket" "artifacts" {
  bucket = "my-artifacts"
}

resource "aws_iam_role" "lambda_exec" {
  name = "lambda-exec-role"
}
```

Expected output:

```json
{
  "modules": [
    { "name": "vpc", "source": "terraform-aws-modules/vpc/aws" }
  ],
  "resources": [
    { "type": "aws_s3_bucket", "service": "S3 Bucket" },
    { "type": "aws_iam_role", "service": "IAM Role" }
  ]
}
```

---

## Workflow Instruction for Claude Code

1. Create the directory structure `.github/actions/tf-scanner/`.
2. Write `action.yml` first (interface contract).
3. Write `index.js` with full logic — recursive walk, regex extraction, dedup, output.
4. Write `package.json`.
5. Write `README.md` with usage docs and example.
6. Run `npm install` inside the action directory to confirm the dependency resolves.
7. If a test runner is available, write a minimal Jest test in `__tests__/scanner.test.js` that:
   - Creates a temporary directory with a mock `.tf` file.
   - Calls the parser function directly.
   - Asserts the returned object matches the expected `modules` and `resources` shape.
