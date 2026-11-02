import "server-only";
import path from "node:path";
import {
  Document,
  Font,
  Image as PdfImage,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { columnValue, type DeliveryLineData, type DeliveryTemplateLayout } from "./rules";

// Delivery note as a PDF file (D-040), for sending by e-mail. Same content
// and order as the paper on screen (delivery-note-paper.tsx); Noto Sans
// because the PDF standard fonts have no č, ć and đ.

const FONT_DIR = path.join(process.cwd(), "src", "assets", "fonts");
Font.register({
  family: "NotoSans",
  fonts: [
    { src: path.join(FONT_DIR, "NotoSans-Regular.ttf") },
    { src: path.join(FONT_DIR, "NotoSans-Bold.ttf"), fontWeight: "bold" },
  ],
});
// Words are never split with added hyphens; long codes may break after
// "-", "/", "_" or "." instead, so they stay inside their cell. Only codes
// longer than a narrow cell get break points: copied text keeps shorter
// numbers whole.
Font.registerHyphenationCallback((word) => [word]);
const breakable = (text: string) =>
  text.replace(/\S{17,}/g, (word) => word.replace(/([-/_.])/g, "$1\u200B"));

const styles = StyleSheet.create({
  page: { fontFamily: "NotoSans", fontSize: 9.5, padding: 34, color: "#000" },
  copy: {
    position: "absolute",
    top: 16,
    right: 34,
    fontSize: 8,
    fontWeight: "bold",
    letterSpacing: 2,
  },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
  logo: { height: 44, maxWidth: 160, objectFit: "contain", marginBottom: 6 },
  bold: { fontWeight: "bold" },
  title: { fontSize: 18, fontWeight: "bold", textAlign: "right" },
  right: { textAlign: "right" },
  label: { fontSize: 7.5, textTransform: "uppercase" },
  customer: { fontSize: 11, fontWeight: "bold" },
  block: { marginBottom: 14 },
  table: { borderTopWidth: 1, borderLeftWidth: 1, borderColor: "#000", marginBottom: 14 },
  row: { flexDirection: "row" },
  cell: { flex: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#000", padding: 4 },
  cancelled: { color: "#b91c1c", fontWeight: "bold", textAlign: "right", marginTop: 4 },
  signatures: { flexDirection: "row", justifyContent: "space-between", marginTop: 50, gap: 30 },
  signature: {
    flex: 1,
    borderTopWidth: 1,
    borderColor: "#000",
    paddingTop: 3,
    textAlign: "center",
  },
});

export type DeliveryNotePdfInput = {
  organizationName: string;
  /** PNG or JPEG bytes of the logo, if any. */
  logo: { data: Buffer; format: "png" | "jpg" } | null;
  layout: DeliveryTemplateLayout;
  number: string;
  date: string;
  cancelled: boolean;
  customer: { name: string; address: string | null; city: string | null; taxId: string | null };
  lines: DeliveryLineData[];
  notes: string | null;
  labels: {
    number: string;
    date: string;
    customer: string;
    taxId: (taxId: string) => string;
    cancelled: string;
    copies: string[];
    quantity: (line: DeliveryLineData) => string;
    unit: (unit: string) => string;
  };
};

function NotePage({ input, copy }: { input: DeliveryNotePdfInput; copy: string }) {
  const { layout, labels } = input;
  return (
    <Page size="A4" style={styles.page}>
      {input.labels.copies.length > 1 ? <Text style={styles.copy}>{copy}</Text> : null}
      <View style={styles.header}>
        <View>
          {input.logo ? <PdfImage src={input.logo} style={styles.logo} /> : null}
          <Text style={styles.bold}>{input.organizationName}</Text>
        </View>
        <View>
          <Text style={styles.title}>{layout.title}</Text>
          <Text style={styles.right}>
            {labels.number}: <Text style={styles.bold}>{input.number}</Text>
          </Text>
          <Text style={styles.right}>
            {labels.date}: {input.date}
          </Text>
          {input.cancelled ? <Text style={styles.cancelled}>{labels.cancelled}</Text> : null}
        </View>
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>{labels.customer}</Text>
        <Text style={styles.customer}>{input.customer.name}</Text>
        {input.customer.address ? <Text>{input.customer.address}</Text> : null}
        {input.customer.city ? <Text>{input.customer.city}</Text> : null}
        {input.customer.taxId ? <Text>{labels.taxId(input.customer.taxId)}</Text> : null}
      </View>

      {layout.header_text ? <Text style={styles.block}>{layout.header_text}</Text> : null}

      <View style={styles.table}>
        <View style={styles.row} fixed>
          {layout.columns.map((column) => (
            <Text key={column.key} style={[styles.cell, styles.bold]}>
              {column.label}
            </Text>
          ))}
        </View>
        {input.lines.map((line) => (
          <View key={line.lineNo} style={styles.row} wrap={false}>
            {layout.columns.map((column) => (
              <Text
                key={column.key}
                style={column.key === "quantity" ? [styles.cell, styles.right] : styles.cell}
              >
                {breakable(columnValue(column.key, line, () => labels.quantity(line), labels.unit))}
              </Text>
            ))}
          </View>
        ))}
      </View>

      {input.notes ? <Text style={styles.block}>{input.notes}</Text> : null}
      {layout.footer_text ? <Text style={styles.block}>{layout.footer_text}</Text> : null}

      {layout.signatures.length > 0 ? (
        <View style={styles.signatures} wrap={false}>
          {layout.signatures.map((label) => (
            <Text key={label} style={styles.signature}>
              {label}
            </Text>
          ))}
        </View>
      ) : null}
    </Page>
  );
}

/** A4 PDF with one page per copy (original, copy). */
export function renderDeliveryNotePdf(input: DeliveryNotePdfInput): Promise<Buffer> {
  return renderToBuffer(
    <Document title={`${input.layout.title} ${input.number}`} author={input.organizationName}>
      {input.labels.copies.map((copy) => (
        <NotePage key={copy} input={input} copy={copy} />
      ))}
    </Document>,
  );
}
