import { scannerNames, type TradingConfig } from "../core/contracts";
import {
  numericRuleFields,
  directionRuleFields,
  exampleScannerRule,
  type RuleCondition,
  type RuleField,
  type ScannerRule,
} from "../core/scanner-rules";

type Rules = NonNullable<TradingConfig["scannerRules"]>;
const metrics = [...numericRuleFields, ...directionRuleFields];
const isDirection = (field: RuleField) =>
  (directionRuleFields as readonly string[]).includes(field.field);
function MetricSelect({
  value,
  onChange,
  label,
}: {
  value: RuleField;
  onChange: (value: RuleField) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={`${value.timeframe}.${value.field}`}
      onChange={(e) => {
        const [timeframe, field] = e.target.value.split(".");
        onChange({
          timeframe: timeframe as RuleField["timeframe"],
          field: field as RuleField["field"],
        });
      }}
    >
      {(["H1", "M15", "M5"] as const).map((timeframe) => (
        <optgroup label={timeframe} key={timeframe}>
          {metrics.map((field) => (
            <option key={field} value={`${timeframe}.${field}`}>
              {timeframe} · {field}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
function ConditionEditor({
  value,
  onChange,
  label,
}: {
  value: RuleCondition;
  onChange: (value: RuleCondition) => void;
  label: string;
}) {
  const directional = isDirection(value.left);
  const rightType = typeof value.right === "object" ? "metric" : "value";
  return (
    <div className="scanner-rule-condition">
      <MetricSelect
        label={`${label} indikator`}
        value={value.left}
        onChange={(left) => {
          const changedType = isDirection(left) !== directional;
          onChange({
            ...value,
            left,
            ...(changedType
              ? { operator: "==", right: isDirection(left) ? "BUY" : 0 }
              : {}),
          });
        }}
      />
      <select
        aria-label={`${label} operator`}
        value={value.operator}
        onChange={(e) =>
          onChange({
            ...value,
            operator: e.target.value as RuleCondition["operator"],
          })
        }
      >
        {(directional ? ["==", "!="] : [">", ">=", "<", "<=", "==", "!="]).map(
          (operator) => (
            <option key={operator}>{operator}</option>
          ),
        )}
      </select>
      <select
        aria-label={`${label} pembanding`}
        value={rightType}
        onChange={(e) =>
          onChange({
            ...value,
            right:
              e.target.value === "metric"
                ? { ...value.left }
                : directional
                  ? "BUY"
                  : 0,
          })
        }
      >
        <option value="value">{directional ? "Arah" : "Angka"}</option>
        <option value="metric">Indikator lain</option>
      </select>
      {typeof value.right === "object" ? (
        <MetricSelect
          label={`${label} indikator pembanding`}
          value={value.right}
          onChange={(right) => onChange({ ...value, right })}
        />
      ) : directional ? (
        <select
          aria-label={`${label} nilai`}
          value={value.right}
          onChange={(e) =>
            onChange({
              ...value,
              right: e.target.value as "BUY" | "SELL" | "NONE",
            })
          }
        >
          {["BUY", "SELL", "NONE"].map((direction) => (
            <option key={direction}>{direction}</option>
          ))}
        </select>
      ) : (
        <input
          aria-label={`${label} nilai`}
          type="number"
          step="any"
          required
          value={
            typeof value.right === "number" && Number.isFinite(value.right)
              ? value.right
              : ""
          }
          onChange={(e) =>
            onChange({
              ...value,
              right: e.target.value === "" ? NaN : Number(e.target.value),
            })
          }
        />
      )}
    </div>
  );
}
export function ScannerRulesEditor({
  value = {},
  onChange,
}: {
  value?: Rules;
  onChange: (value: Rules) => void;
}) {
  return (
    <fieldset>
      <legend>Aturan BUY / SELL</legend>
      <p>
        Gunakan strategi bawaan atau susun kondisi per scanner. ALL meminta
        semua kondisi, ANY cukup satu. Jika BUY dan SELL sama-sama cocok, hasil
        NONE. Setiap perubahan mengikuti Activation dan versi konfigurasi.
      </p>
      {scannerNames.map((name) => {
        const rule = value[name];
        const update = (next: ScannerRule) =>
          onChange({ ...value, [name]: next });
        return (
          <fieldset key={name}>
            <legend>{name}</legend>
            <label>
              Mode strategi {name}
              <select
                aria-label={`Mode strategi ${name}`}
                value={rule?.mode ?? "BUILTIN"}
                onChange={(e) => {
                  if (e.target.value === "BUILTIN") {
                    const next = { ...value };
                    delete next[name];
                    onChange(next);
                  } else
                    update({
                      ...(rule ?? exampleScannerRule()),
                      mode: e.target.value as ScannerRule["mode"],
                    });
                }}
              >
                <option value="BUILTIN">Strategi bawaan</option>
                <option value="CUSTOM">Aturan kustom</option>
                <option value="DISABLED">Nonaktif</option>
              </select>
            </label>
            {rule?.mode === "CUSTOM" &&
              (["buy", "sell"] as const).map((side) => (
                <fieldset key={side}>
                  <legend>{side.toUpperCase()}</legend>
                  <label>
                    Pencocokan
                    <select
                      aria-label={`${name} ${side} pencocokan`}
                      value={rule[side].match}
                      onChange={(e) =>
                        update({
                          ...rule,
                          [side]: {
                            ...rule[side],
                            match: e.target.value as "ALL" | "ANY",
                          },
                        })
                      }
                    >
                      <option value="ALL">ALL · semua kondisi</option>
                      <option value="ANY">ANY · salah satu kondisi</option>
                    </select>
                  </label>
                  {rule[side].conditions.map((condition, index) => (
                    <div className="scanner-rule-row" key={index}>
                      <ConditionEditor
                        label={`${name} ${side} ${index + 1}`}
                        value={condition}
                        onChange={(next) =>
                          update({
                            ...rule,
                            [side]: {
                              ...rule[side],
                              conditions: rule[side].conditions.map(
                                (current, i) => (i === index ? next : current),
                              ),
                            },
                          })
                        }
                      />
                      <button
                        disabled={rule[side].conditions.length <= 1}
                        onClick={() =>
                          update({
                            ...rule,
                            [side]: {
                              ...rule[side],
                              conditions: rule[side].conditions.filter(
                                (_, i) => i !== index,
                              ),
                            },
                          })
                        }
                        aria-label={`Hapus kondisi ${name} ${side} ${index + 1}`}
                      >
                        Hapus kondisi
                      </button>
                    </div>
                  ))}
                  <button
                    disabled={rule[side].conditions.length >= 12}
                    onClick={() =>
                      update({
                        ...rule,
                        [side]: {
                          ...rule[side],
                          conditions: [
                            ...rule[side].conditions,
                            exampleScannerRule()[side].conditions[0],
                          ],
                        },
                      })
                    }
                  >
                    Tambah kondisi {side.toUpperCase()}
                  </button>
                </fieldset>
              ))}
          </fieldset>
        );
      })}
    </fieldset>
  );
}
