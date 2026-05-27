#!/usr/bin/env node
/**
 * Script to process world-rewound.geojson and output europe.geojson:
 * 1. Merge DE+LU into DE (geometric union removes internal border)
 * 2. Merge IE+GB-NIR into IE (geometric union removes internal border)
 * 3. Filter out non-European countries (but keep bordering African/Asian ENTSO-E countries)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { union } from '@turf/union';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT = resolve(__dirname, '../../public/world-rewound.geojson');
const OUTPUT = resolve(__dirname, '../../public/europe.geojson');

// ---------------------------------------------------------------------------
// List of countryKeys to keep.
// This includes:
//   - All European countries (EU, EEA, Western Balkans, UK, CH, NO, etc.)
//   - ENTSO-E neighbours / members in North Africa & Middle East / Caucasus
//   - Georgia (GE) – counted as Asia but part of ENTSO-E dataset
// ---------------------------------------------------------------------------
const KEEP_COUNTRY_KEYS = new Set([
  // ---- Europe ----
  'AL', // Albania
  'AD', // Andorra
  'AM', // Armenia (sometimes considered Europe, part of ENTSO-E)
  'AT', // Austria
  'AZ', // Azerbaijan (part of ENTSO-E)
  'BA', // Bosnia and Herzegovina
  'BE', // Belgium
  'BG', // Bulgaria
  'BY', // Belarus
  'CH', // Switzerland
  'CY', // Cyprus (geographically Asia, but EU)
  'CZ', // Czechia
  'DE', // Germany (will be merged with LU)
  'DK', // Denmark
  'EE', // Estonia
  'ES', // Spain
  'FI', // Finland
  'FO', // Faroe Islands
  'FR', // France
  'GB', // United Kingdom
  'GE', // Georgia (ENTSO-E member)
  'GI', // Gibraltar
  'GR', // Greece
  'HR', // Croatia
  'HU', // Hungary
  'IE', // Ireland (will be merged with GB-NIR)
  'IS', // Iceland
  'IT', // Italy
  'JE', // Jersey
  'LI', // Liechtenstein
  'LT', // Lithuania
  'LU', // Luxembourg (will be merged with DE)
  'LV', // Latvia
  'MC', // Monaco
  'MD', // Moldova
  'ME', // Montenegro
  'MK', // North Macedonia
  'MT', // Malta
  'NL', // Netherlands
  'NO', // Norway
  'PL', // Poland
  'PT', // Portugal
  'RO', // Romania
  'RS', // Serbia
  'RU', // Russia (partly in Europe, part of ENTSO-E)
  'SE', // Sweden
  'SI', // Slovenia
  'SK', // Slovakia
  'SM', // San Marino
  'TR', // Turkey (ENTSO-E member)
  'UA', // Ukraine
  'XK', // Kosovo
  'GG', // Guernsey
  'IM', // Isle of Man
  'SJ', // Svalbard and Jan Mayen
]);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const raw = readFileSync(INPUT, 'utf-8');
  const geo = JSON.parse(raw);

  if (geo.type !== 'FeatureCollection' || !Array.isArray(geo.features)) {
    console.error('Unexpected GeoJSON structure');
    process.exit(1);
  }

  // Separate features into keepers and ones to merge
  const keepFeatures = [];
  // Merge targets map from merge-key → { features, outputProps }
  const mergeTargets = {
    DE:  { features: [], outputProps: { zoneName: 'DE',  countryKey: 'DE',  countryName: 'Germany' } },
    IE:  { features: [], outputProps: { zoneName: 'IE',  countryKey: 'IE',  countryName: 'Ireland' } },
  };

  for (const feature of geo.features) {
    const props = feature.properties;
    if (!props || !props.zoneName) {
      keepFeatures.push(feature);
      continue;
    }

    const zoneName = props.zoneName;

    // Merge candidates
    if (zoneName === 'DE' || zoneName === 'LU') {
      mergeTargets.DE.features.push(feature);
      continue;
    }
    if (zoneName === 'IE' || zoneName === 'GB-NIR') {
      mergeTargets.IE.features.push(feature);
      continue;
    }

    // Filter: skip if not in keep list
    if (!KEEP_COUNTRY_KEYS.has(props.countryKey)) {
      continue;
    }

    keepFeatures.push(feature);
  }

  // Merge geometries
  for (const [mergeKey, { features: featureList, outputProps }] of Object.entries(mergeTargets)) {
    if (featureList.length === 0) {
      console.warn(`Warning: no features found for merge target "${mergeKey}"`);
      continue;
    }

    const zoneNames = featureList.map(f => f.properties.zoneName).join(' + ');

    // Use turf.union to geometrically dissolve the features,
    // removing any internal border between adjacent polygons
    const mergedGeom = union({ type: 'FeatureCollection', features: featureList });

    const mergedFeature = {
      type: 'Feature',
      properties: { ...outputProps },
      geometry: mergedGeom.geometry,
    };

    keepFeatures.push(mergedFeature);
    console.log(`Merged ${featureList.length} features (${zoneNames}) into "${outputProps.zoneName}" — dissolved internal border`);
  }

  // Build output
  const output = {
    type: 'FeatureCollection',
    features: keepFeatures,
  };

  writeFileSync(OUTPUT, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\nWrote ${keepFeatures.length} features to ${OUTPUT}`);
  console.log(`Original features: ${geo.features.length}`);
  console.log(`Filtered + merged features: ${keepFeatures.length}`);
}

main();
