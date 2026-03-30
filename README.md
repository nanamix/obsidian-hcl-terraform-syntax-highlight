# HCL Terraform Syntax Highlight

Obsidian 편집기에서 `hcl`, `terraform`, `terraform-vars`, `tf`, `tfvars` 코드펜스에 대한 Syntax Highlight를 적용하는 최소 플러그인입니다.

## 해결하려는 문제

- Terraform/HCL 코드 블록이 기본 Obsidian 편집기에서 일반 텍스트처럼 보이는 문제를 줄인다.
- `terraform`과 `hcl`을 같은 HCL 파서로 묶어 일관된 하이라이트를 제공한다.

## 동작 방식

- Obsidian의 CodeMirror 6 editor extension API를 사용한다.
- Markdown fenced code block 언어 매핑에 `codemirror-lang-hcl` 파서를 연결한다.
- `terraform`, `terraform-vars`, `tf`, `tfvars`는 모두 `hcl` 파서로 매핑한다.

## 지원 언어

- `hcl`
- `terraform`
- `terraform-vars`
- `tf`
- `tfvars`

## 현재 범위

- 우선 편집기(Source mode / Live Preview) 쪽 코드펜스 하이라이트를 해결한다.
- Reading mode 전용 렌더링은 다음 단계에서 필요 시 확장할 수 있다.

## 개발 메모

1. `npm install`
2. `npm run build`
3. 빌드 산출물 `main.js`, `manifest.json`, `styles.css`를 Vault의 `.obsidian/plugins/<plugin-id>/`에 배치한다.

## 참고

- Obsidian developer docs: https://docs.obsidian.md
- CodeMirror markdown language: https://github.com/codemirror/lang-markdown
- HashiCorp grammar mapping: https://github.com/hashicorp/syntax
- HCL parser package: https://www.npmjs.com/package/codemirror-lang-hcl
