/**
 * OpenUI 组件库的 web 渲染器（web / Tauri 桌面 / Capacitor 移动壳共用）。
 * 契约见 ./spec.ts；RN 端同名组件在 apps/mobile-rn/src/openui/library.tsx。
 */
import { FormNameContext, useFormName, useIsStreaming, useStateField, useTriggerAction } from "@openuidev/react-lang";
import { createOpenBotLibrary, type OpenBotRenderers } from "./spec";

const renderers: OpenBotRenderers = {
  Card: ({ props, renderNode }) => (
    <section className="oui-card">
      {props.title ? <div className="oui-card-title">{props.title}</div> : null}
      <div className="oui-card-body">{renderNode(props.children)}</div>
    </section>
  ),
  Text: ({ props }) => {
    const v = props.variant ?? "body";
    return <p className={`oui-text oui-text-${v}`}>{props.content}</p>;
  },
  Button: function OuiButton({ props }) {
    const trigger = useTriggerAction();
    const streaming = useIsStreaming();
    const formName = useFormName();
    return (
      <button
        type="button"
        className={`oui-btn${props.variant === "primary" ? " oui-btn-primary" : ""}`}
        disabled={streaming}
        onClick={() => void trigger(props.label, formName, props.action as never)}
      >
        {props.label}
      </button>
    );
  },
  Buttons: ({ props, renderNode }) => <div className="oui-buttons">{renderNode(props.buttons)}</div>,
  Table: ({ props }) => (
    <div className="oui-table-wrap">
      <table className="oui-table">
        <thead>
          <tr>
            {props.headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, r) => (
            <tr key={r}>
              {row.map((c, i) => (
                <td key={i}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
  List: ({ props }) =>
    props.ordered ? (
      <ol className="oui-list">
        {props.items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ol>
    ) : (
      <ul className="oui-list">
        {props.items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    ),
  Field: ({ props }) => (
    <div className="oui-field">
      <span className="oui-field-label">{props.label}</span>
      <span className="oui-field-value">{props.value}</span>
    </div>
  ),
  Form: ({ props, renderNode }) => (
    <FormNameContext.Provider value={props.name}>
      <form className="oui-form" onSubmit={(e) => e.preventDefault()}>
        {renderNode(props.fields)}
        <div className="oui-buttons">{renderNode(props.submit)}</div>
      </form>
    </FormNameContext.Provider>
  ),
  Input: function OuiInput({ props }) {
    const field = useStateField<string>(props.name);
    const streaming = useIsStreaming();
    return (
      <label className="oui-input">
        <span>{props.label}</span>
        <input
          name={props.name}
          placeholder={props.placeholder}
          value={(field.value as string | undefined) ?? ""}
          disabled={streaming}
          onChange={(e) => field.setValue(e.target.value)}
        />
      </label>
    );
  },
  Select: function OuiSelect({ props }) {
    const field = useStateField<string>(props.name);
    const streaming = useIsStreaming();
    return (
      <label className="oui-input">
        <span>{props.label}</span>
        <select
          name={props.name}
          value={(field.value as string | undefined) ?? ""}
          disabled={streaming}
          onChange={(e) => field.setValue(e.target.value)}
        >
          <option value="" disabled>
            请选择
          </option>
          {props.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  },
};

export const openBotLibrary = createOpenBotLibrary(renderers);
