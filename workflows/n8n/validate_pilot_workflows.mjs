import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const workflowFiles = [
  'shamo_pilot_extract_and_stage.json',
  'shamo_pilot_approve_and_publish.json',
];

const errors = [];

function validateStrictSchema(schema, location) {
  if (!schema || typeof schema !== 'object') return;

  if (schema.type === 'object' && schema.properties) {
    const propertyNames = Object.keys(schema.properties).sort();
    const requiredNames = [...(schema.required ?? [])].sort();

    if (schema.additionalProperties !== false) {
      errors.push(`${location}: object schema must set additionalProperties to false`);
    }
    if (JSON.stringify(propertyNames) !== JSON.stringify(requiredNames)) {
      errors.push(`${location}: required must contain every property`);
    }
  }

  for (const [key, value] of Object.entries(schema)) {
    if (value && typeof value === 'object') {
      validateStrictSchema(value, `${location}.${key}`);
    }
  }
}

for (const fileName of workflowFiles) {
  const filePath = path.join(directory, fileName);
  const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const names = new Set();
  const ids = new Set();

  if (workflow.active !== false) {
    errors.push(`${fileName}: workflow must be inactive`);
  }

  for (const node of workflow.nodes ?? []) {
    if (names.has(node.name)) errors.push(`${fileName}: duplicate node name ${node.name}`);
    if (ids.has(node.id)) errors.push(`${fileName}: duplicate node id ${node.id}`);
    names.add(node.name);
    ids.add(node.id);

    if (node.type === 'n8n-nodes-base.code') {
      try {
        new Function(node.parameters?.jsCode ?? '');
      } catch (error) {
        errors.push(`${fileName}: invalid JavaScript in ${node.name}: ${error.message}`);
      }
    }
  }

  if (fileName === 'shamo_pilot_extract_and_stage.json') {
    const mistralNode = workflow.nodes.find((node) => node.name === 'Mistral OCR');
    if (mistralNode?.parameters?.jsonBody !== '={{ $json.mistral_request }}') {
      errors.push(
        `${fileName}: Mistral OCR must use the parser-safe mistral_request reference`,
      );
    }
    const expandNode = workflow.nodes.find(
      (node) => node.name === 'Expand Pilot Documents',
    );
    if (!expandNode?.parameters?.jsCode?.includes('mistral_request: mistralRequest')) {
      errors.push(
        `${fileName}: Expand Pilot Documents must construct mistral_request`,
      );
    }
    const requiredNodes = [
      'Build Question Paper Request',
      'OpenAI Question Paper Extraction',
      'Parse Question Paper',
      'Build Mark Scheme Requests',
      'OpenAI Mark Scheme Questions',
      'Parse Mark Scheme Responses',
      'Merge Paper Bundle',
      'Build Targeted Repair Request',
      'Repair Needed',
      'OpenAI Targeted Question Repair',
      'Parse Targeted Repair',
      'Deterministic Validation After Repair',
      'OpenAI Final Independent Verifier',
      'Parse Final Verifier Result',
      'Select Final Validation State',
    ];
    for (const requiredNode of requiredNodes) {
      if (!workflow.nodes.some((node) => node.name === requiredNode)) {
        errors.push(`${fileName}: missing required node ${requiredNode}`);
      }
    }
  }

  if (fileName === 'shamo_pilot_approve_and_publish.json') {
    const publishNode = workflow.nodes.find(
      (node) => node.name === 'Publish Paper Bundle',
    );
    if (
      !publishNode?.parameters?.url?.includes(
        '/rest/v1/rpc/shamo_publish_paper_bundle_v2',
      )
    ) {
      errors.push(`${fileName}: publication must call the v2 RPC`);
    }
  }

  for (const [source, connectionGroups] of Object.entries(workflow.connections ?? {})) {
    if (!names.has(source)) {
      errors.push(`${fileName}: connection source does not exist: ${source}`);
    }
    for (const outputs of Object.values(connectionGroups)) {
      for (const output of outputs) {
        for (const connection of output) {
          if (!names.has(connection.node)) {
            errors.push(
              `${fileName}: ${source} connects to missing node ${connection.node}`,
            );
          }
        }
      }
    }
  }

  const serialized = JSON.stringify(workflow);
  const forbiddenPatterns = [
    /sk-[A-Za-z0-9_-]{16,}/,
    /Bearer\s+[A-Za-z0-9._-]{16,}/,
    /service_role\s*[:=]\s*["'][A-Za-z0-9._-]+/i,
  ];
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(serialized)) {
      errors.push(`${fileName}: possible embedded secret matching ${pattern}`);
    }
  }

  for (const node of workflow.nodes ?? []) {
    if (!node.name.startsWith('OpenAI ')) {
      continue;
    }

    const code = node.parameters?.jsCode ?? '';
    if (/minLength|maxLength/.test(code)) {
      errors.push(`${fileName}: ${node.name} contains unsupported string length keywords`);
    }
  }
}

const contractPath = path.join(directory, 'shamo_paper_bundle.schema.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
validateStrictSchema(contract, 'shamo_paper_bundle.schema.json');
const markItemSchema =
  contract.properties?.questions?.items?.properties?.mark_scheme_items?.items;
if (!markItemSchema?.required?.includes('guidance_markdown')) {
  errors.push('shamo_paper_bundle.schema.json: guidance_markdown must be required');
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Pilot workflow validation passed.');
console.log(`Checked ${workflowFiles.length} workflows and the publication contract.`);
