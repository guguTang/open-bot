/**
 * OpenUI 组件库的 web 渲染器（web / Tauri 桌面 / Capacitor 移动壳共用）。
 * 契约见 ./spec.ts；RN 端同名组件在 apps/mobile-rn/src/openui/library.tsx。
 */
import { createContext, useContext } from "react";
import { FormNameContext, useFormName, useIsStreaming, useStateField, useTriggerAction } from "@openuidev/react-lang";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createOpenBotLibrary, type OpenBotRenderers } from "./spec";

/** Peer Buttons flatten hierarchy — all secondary (taste: sibling items uniform). */
const OuiPeerButtonsContext = createContext(false);

const renderers: OpenBotRenderers = {
  Card: ({ props, renderNode }) => (
    <Card className="oui-card">
      {props.title ? (
        <CardHeader>
          <CardTitle className="oui-card-title">{props.title}</CardTitle>
        </CardHeader>
      ) : null}
      <CardContent className="oui-card-body">{renderNode(props.children)}</CardContent>
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
    const peer = useContext(OuiPeerButtonsContext);
    const primary = !peer && props.variant === "primary";
    return (
      <Button
        variant={primary ? "primary" : "secondary"}
        className={`oui-btn${primary ? " oui-btn-primary" : ""}`}
        disabled={streaming}
        onClick={() => void trigger(props.label, formName, props.action as never)}
      >
        {props.label}
      </Button>
    );
  },
  Buttons: ({ props, renderNode }) => (
    <OuiPeerButtonsContext.Provider value={true}>
      <div className="oui-buttons">{renderNode(props.buttons)}</div>
    </OuiPeerButtonsContext.Provider>
  ),
  Table: ({ props }) => (
    <div className="oui-table-block">
    <div className="oui-table-scroll max-w-full">
      <table className="oui-table w-max min-w-full caption-bottom text-sm">
        <TableHeader>
          <TableRow>
            {props.headers.map((h, i) => (
              <TableHead key={i} scope={i === 0 ? "row" : undefined}>
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.rows.map((row, r) => (
            <TableRow key={r}>
              {row.map((c, i) => (
                <TableCell key={i} className="tabular-nums">
                  {c}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </table>
    </div>
    {/* Narrow containers: stacked card list instead of a sideways-scrolling table */}
    <ul className="oui-table-cards" aria-label="数据表">
      {props.rows.map((row, r) => (
        <li key={r} className="oui-table-card">
          <div className="oui-table-card-title">{row[0]}</div>
          <dl>
            {row.slice(1).map((c, i) => (
              <div key={i} style={{ display: "contents" }}>
                <dt>{props.headers[i + 1]}</dt>
                <dd>{c}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
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
      <div className="oui-input flex flex-col gap-1.5">
        <Label htmlFor={`oui-${props.name}`}>{props.label}</Label>
        <Input
          id={`oui-${props.name}`}
          name={props.name}
          value={(field.value as string | undefined) ?? ""}
          disabled={streaming}
          placeholder={props.placeholder}
          onChange={(e) => field.setValue(e.target.value)}
        />
      </div>
    );
  },
  Select: function OuiSelect({ props }) {
    const field = useStateField<string>(props.name);
    const streaming = useIsStreaming();
    return (
      <div className="oui-input flex flex-col gap-1.5">
        <Label htmlFor={`oui-${props.name}`}>{props.label}</Label>
        <Select
          value={(field.value as string | undefined) ?? ""}
          disabled={streaming}
          onValueChange={(next) => field.setValue(next)}
        >
          <SelectTrigger id={`oui-${props.name}`} className="oui-select">
            <SelectValue placeholder="请选择" />
          </SelectTrigger>
          <SelectContent>
            {props.options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  },
};

export const openBotLibrary = createOpenBotLibrary(renderers);
