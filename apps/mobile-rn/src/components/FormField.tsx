import {
  Description,
  FieldError,
  Input,
  Label,
  Switch,
  TextArea,
  TextField,
  Typography,
} from "heroui-native";
import type { JSX, ReactNode } from "react";
import { Text, View } from "react-native";

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  error?: string | null;
  hint?: string;
  multiline?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "url" | "email-address" | "numeric" | "phone-pad";
  /** 密码/密钥类输入。API Key 必须走这个，不能明文显示 */
  secureTextEntry?: boolean;
  editable?: boolean;
  required?: boolean;
};

/** 单行文本字段。设置页里出现最多的形态，单独抽出来免得每个页面重复 15 行。 */
export function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  hint,
  multiline,
  autoCapitalize = "none",
  keyboardType = "default",
  secureTextEntry,
  editable = true,
  required,
}: FieldProps): JSX.Element {
  return (
    <TextField isInvalid={Boolean(error)} isRequired={required}>
      <Label>
        <Label.Text>
          {label}
          {/* 必填标记用 accent 色的点，而不是裸的「*」——
              星号读起来像标点，色点读起来才像「这里必须填」。 */}
          {required ? <Text className="text-accent"> •</Text> : null}
        </Label.Text>
      </Label>
      {multiline ? (
        <TextArea
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          editable={editable}
          autoCapitalize={autoCapitalize}
          keyboardType={keyboardType}
          className="min-h-[88px]"
        />
      ) : (
        <Input
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          editable={editable}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
        />
      )}
      {error ? <FieldError isInvalid>{error}</FieldError> : null}
      {/* 提示语是 description 语义，不是又一个 label */}
      {!error && hint ? <Description className="text-xs">{hint}</Description> : null}
    </TextField>
  );
}

/** 开关行：左标题右开关，整行可点。 */
export function SwitchRow({
  label,
  description,
  value,
  onValueChange,
  disabled,
  right,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  right?: ReactNode;
}): JSX.Element {
  return (
    <View className="flex-row items-center gap-3 px-1 py-1">
      <View className="flex-1 gap-0.5">
        <Typography.Paragraph>{label}</Typography.Paragraph>
        {description ? (
          <Typography.Paragraph color="muted" className="text-xs">
            {description}
          </Typography.Paragraph>
        ) : null}
      </View>
      {right}
      {/* 开关固定在行尾 */}
      <Switch isSelected={value} onSelectedChange={onValueChange} isDisabled={disabled} />
    </View>
  );
}

/**
 * 分组小标题，把设置页切成可扫读的段落。
 *
 * 用 Typography 而不是 `Label`：`Label` 是表单字段的语义（小号 + 跟随字段控件），
 * 拿它当分区标题会让这一行看起来像某个输入框的标签。排版上与首页、
 * 设置列表页的分区标题保持同一套：text-sm + muted。
 */
export function SectionTitle({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Typography.Paragraph color="muted" className="text-sm">
      {children}
    </Typography.Paragraph>
  );
}
