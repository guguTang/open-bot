/**
 * OpenUI 组件库的 web 渲染器（web / Tauri 桌面 / Capacitor 移动壳共用）。
 * 契约见 ./spec.ts；RN 端同名组件在 apps/mobile-rn/src/openui/library.tsx。
 */
import { FormNameContext, useFormName, useIsStreaming, useStateField, useTriggerAction } from "@openuidev/react-lang";
import { Button, Card, Input, Label, Table, TextField } from "@heroui/react";
import { NativeSelect } from "@heroui-pro/react";
import { createOpenBotLibrary, type OpenBotRenderers } from "./spec";

const renderers: OpenBotRenderers = {
  Card: ({ props, renderNode }) => (
    <Card variant="secondary" className="oui-card">
      {props.title ? (
        <Card.Header>
          <Card.Title className="oui-card-title">{props.title}</Card.Title>
        </Card.Header>
      ) : null}
      <Card.Content className="oui-card-body">{renderNode(props.children)}</Card.Content>
    </Card>
  ),
  Text: ({ props }) => {
    const v = props.variant ?? "body";
    return <p className={`oui-text oui-text-${v}`}>{props.content}</p>;
  },
  Button: function OuiButton({ props }) {
    const trigger = useTriggerAction();
    const streaming = useIsStreaming();
    const formName = useFormName();
    const primary = props.variant === "primary";
    return (
      <Button
        size="sm"
        variant={primary ? "primary" : "outline"}
        className={`oui-btn${primary ? " oui-btn-primary" : ""}`}
        isDisabled={streaming}
        onPress={() => void trigger(props.label, formName, props.action as never)}
      >
        {props.label}
      </Button>
    );
  },
  Buttons: ({ props, renderNode }) => <div className="oui-buttons">{renderNode(props.buttons)}</div>,
  Table: ({ props }) => (
    <Table variant="secondary" className="oui-table-wrap">
      <Table.ScrollContainer>
        <Table.Content aria-label="数据表" className="oui-table">
          <Table.Header>
            {props.headers.map((h, i) => (
              <Table.Column key={i} isRowHeader={i === 0}>
                {h}
              </Table.Column>
            ))}
          </Table.Header>
          <Table.Body>
            {props.rows.map((row, r) => (
              <Table.Row key={r}>
                {row.map((c, i) => (
                  <Table.Cell key={i} className="tabular-nums">
                    {c}
                  </Table.Cell>
                ))}
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
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
      <span className="oui-field-label text-muted">{props.label}</span>
      <span className="oui-field-value tabular-nums">{props.value}</span>
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
      <TextField
        className="oui-input"
        name={props.name}
        value={(field.value as string | undefined) ?? ""}
        isDisabled={streaming}
        onChange={(v) => field.setValue(v)}
      >
        <Label>{props.label}</Label>
        <Input variant="secondary" placeholder={props.placeholder} />
      </TextField>
    );
  },
  Select: function OuiSelect({ props }) {
    const field = useStateField<string>(props.name);
    const streaming = useIsStreaming();
    return (
      <NativeSelect fullWidth className="oui-input">
        <Label>{props.label}</Label>
        <NativeSelect.Trigger
          name={props.name}
          value={(field.value as string | undefined) ?? ""}
          disabled={streaming}
          onChange={(e) => field.setValue(e.target.value)}
        >
          <NativeSelect.Option value="" disabled>
            请选择
          </NativeSelect.Option>
          {props.options.map((o) => (
            <NativeSelect.Option key={o} value={o}>
              {o}
            </NativeSelect.Option>
          ))}
          <NativeSelect.Indicator />
        </NativeSelect.Trigger>
      </NativeSelect>
    );
  },
};

export const openBotLibrary = createOpenBotLibrary(renderers);
