import React from "react";
import { format } from "date-fns";
import amiriFontUrl from "../assets/Amiri-Regular.ttf?url";

export const BISMILLAH_ARABIC = "بسم الله الرحمن الرحيم";

export const OFFICIAL_IDENTITY = {
  companyName: "Hazari Gold L.L.C",
  address: [
    "Matar Abdul Rahman Khalfan Al Muhairi Building,",
    "1st Floor,",
    "Room# 101, Deira, Dubai, UAE"
  ],
  phone: "+971509364193",
  email: "hazarigoldllc@gmail.com",
  trn: "105301944200003",
  logoUrl: `${import.meta.env.BASE_URL}hazari-gold-logo.jpg`,
  stampUrl: `${import.meta.env.BASE_URL}hazari-gold-stamp.png`,
};

export const NAVY = "#1e3a5f";
export const GOLD = "#c8a43a";
export const STATEMENT_PDF_MARGIN = [17, 10, 10, 10] as const;
export const STATEMENT_FIRST_PAGE_SPACER = "39mm";
export const STATEMENT_FINAL_FOOTER_SPACER = "50mm";
const AUTHORISED_SIGNATURE_BANNER_GAP_MM = 18;
let amiriFontBase64Promise: Promise<string> | null = null;

function loadAmiriFontBase64(): Promise<string> {
  if (!amiriFontBase64Promise) {
    amiriFontBase64Promise = fetch(amiriFontUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load Arabic PDF font: HTTP ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then((buffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        const chunkSize = 0x8000;
        for (let index = 0; index < bytes.length; index += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
        }
        return btoa(binary);
      });
  }
  return amiriFontBase64Promise;
}

export function PdfCompanyDetails() {
  return (
    <>
      <div style={{ marginBottom: "8px" }}>
        <img
          src={OFFICIAL_IDENTITY.logoUrl}
          alt="Hazari Gold Logo"
          style={{ width: "150px", height: "auto", display: "block", borderRadius: "6px" }}
        />
      </div>
      <div style={{ fontWeight: "bold", fontSize: "14px", color: NAVY, marginBottom: "4px" }}>
        {OFFICIAL_IDENTITY.companyName}
      </div>
      <div style={{ color: "#333", lineHeight: "1.6", fontSize: "10px" }}>
        <div style={{ display: "flex", gap: "4px" }}>
          <span style={{ fontWeight: "bold", minWidth: "40px" }}>Address:</span>
          <div>
            {OFFICIAL_IDENTITY.address.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        </div>
        <div style={{ marginTop: "4px", display: "flex", gap: "4px" }}>
          <span style={{ fontWeight: "bold", minWidth: "40px" }}>Phone:</span>
          <div>{OFFICIAL_IDENTITY.phone}</div>
        </div>
        <div style={{ marginTop: "2px", display: "flex", gap: "4px" }}>
          <span style={{ fontWeight: "bold", minWidth: "40px" }}>Email:</span>
          <div>{OFFICIAL_IDENTITY.email}</div>
        </div>
        <div style={{ marginTop: "2px", display: "flex", gap: "4px" }}>
          <span style={{ fontWeight: "bold", minWidth: "40px" }}>TRN:</span>
          <div>{OFFICIAL_IDENTITY.trn}</div>
        </div>
      </div>
    </>
  );
}

export function PdfInvoiceSignatureBlock() {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", minHeight: "32mm", padding: "0 10mm" }}>
      <div style={{ width: "160px", textAlign: "center", borderTop: "1px solid #333", paddingTop: "4px", fontSize: "11px", fontWeight: "bold", color: NAVY }}>
        Customer&apos;s Signature
      </div>
      <div style={{ width: "160px", textAlign: "center", borderTop: "1px solid #333", paddingTop: "4px", fontSize: "11px", fontWeight: "bold", color: NAVY }}>
        Checked By
      </div>
      <div style={{ width: "160px", textAlign: "center", borderTop: "1px solid #333", paddingTop: "4px", fontSize: "11px", fontWeight: "bold", color: NAVY, position: "relative" }}>
        <img
          src={OFFICIAL_IDENTITY.stampUrl}
          alt="Official Hazari Gold seal"
          style={{
            position: "absolute",
            bottom: "30px",
            left: "50%",
            transform: "translateX(-50%)",
            width: "110px",
            height: "auto",
            opacity: 0.9,
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
        <span style={{ position: "relative", zIndex: 1 }}>Authorised Signature</span>
      </div>
    </div>
  );
}

export function PdfFooter({ absolute = false }: { absolute?: boolean }) {
  const containerStyle: React.CSSProperties = absolute
    ? { position: "absolute", bottom: 0, left: 0, right: 0 }
    : { marginTop: "40px", breakInside: "avoid", pageBreakInside: "avoid" };

  return (
    <div style={containerStyle}>
      <PdfInvoiceSignatureBlock />
      <div aria-hidden="true" style={{ height: `${AUTHORISED_SIGNATURE_BANNER_GAP_MM}mm` }} />
      <div style={{ background: NAVY, color: "white", textAlign: "center", padding: "8px", fontWeight: "bold", fontSize: "12px", letterSpacing: "0.5px" }}>
        Thank you for your business!
      </div>
    </div>
  );
}

export async function decorateStatementPdf(
  pdf: any,
  options: {
    title: string;
    subtitle: string;
    userName: string;
    columns: Array<{ label: string; width: number; align?: "left" | "right" }>;
  }
) {
  const loadImg = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load required PDF brand asset: ${src}`));
    img.src = src;
  });

  const [logoImg, stampImg, amiriFontBase64] = await Promise.all([
    loadImg(OFFICIAL_IDENTITY.logoUrl),
    loadImg(OFFICIAL_IDENTITY.stampUrl),
    loadAmiriFontBase64(),
  ]);
  pdf.addFileToVFS("Amiri-Regular.ttf", amiriFontBase64);
  pdf.addFont("Amiri-Regular.ttf", "Amiri", "normal");

  const totalPages = pdf.internal.getNumberOfPages();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    if (i === 1) {
      // The complete legal identity is exclusive to the opening page.
      pdf.setFillColor(200, 164, 58);
      pdf.rect(0, 0, pageWidth, 2, "F");

      pdf.setTextColor(200, 164, 58);
      pdf.setFont("Amiri", "normal");
      pdf.setFontSize(14);
      pdf.text(BISMILLAH_ARABIC, pageWidth / 2, 7, { align: "center" });

      if (logoImg.width > 0) {
        const logoAspect = logoImg.height / logoImg.width;
        const logoW = 36;
        const logoH = logoW * logoAspect;
        pdf.addImage(logoImg, "JPEG", 10, 8, logoW, logoH);

        pdf.setTextColor(30, 58, 95);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(12);
        pdf.text(OFFICIAL_IDENTITY.companyName, 50, 11);

        pdf.setTextColor(51, 51, 51);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(7.2);
        pdf.text(OFFICIAL_IDENTITY.address.join(" "), 50, 16);
        pdf.text(
          `Phone: ${OFFICIAL_IDENTITY.phone}   Email: ${OFFICIAL_IDENTITY.email}   TRN: ${OFFICIAL_IDENTITY.trn}`,
          50,
          20.5,
        );
      }

      pdf.setTextColor(119, 119, 119);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      pdf.text(`Generated by ${options.userName} on ${format(new Date(), "dd/MM/yyyy hh:mm a")}`, pageWidth - 10, 25, { align: "right" });

      pdf.setFillColor(30, 58, 95);
      pdf.rect(0, 29, pageWidth, 9, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.text(options.title.toUpperCase(), 10, 34.9);

      pdf.setFillColor(245, 243, 238);
      pdf.rect(10, 40, pageWidth - 20, 7, "F");
      pdf.setTextColor(30, 58, 95);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7.5);
      pdf.text(options.subtitle, 12, 44.6, { maxWidth: pageWidth - 24 });
    }

    // The HTML table header is part of the first page's source content.
    // html2pdf rasterizes the DOM, so repeat it here on continuation pages.
    if (i > 1) {
      let columnX = 10;
      const columnY = 10;
      const columnHeight = 7;
      pdf.setFillColor(30, 58, 95);
      pdf.setDrawColor(255, 255, 255);
      pdf.setLineWidth(0.15);
      pdf.rect(10, columnY, pageWidth - 20, columnHeight, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(6.5);

      for (const column of options.columns) {
        if (columnX > 10) {
          pdf.line(columnX, columnY, columnX, columnY + columnHeight);
        }
        const align = column.align ?? "left";
        pdf.text(
          column.label,
          align === "right" ? columnX + column.width - 1.2 : columnX + 1.2,
          columnY + 4.6,
          { align, maxWidth: column.width - 2.4 },
        );
        columnX += column.width;
      }
    }

    if (i === totalPages) {
      // The authorised signature and closing banner are exclusive to the final page.
      const signatureWidth = 50;
      const signatureX = pageWidth - 10 - signatureWidth;
      const signatureCenterX = signatureX + signatureWidth / 2;
      const bannerY = pageHeight - 12;
      const signatureLineY = bannerY - AUTHORISED_SIGNATURE_BANNER_GAP_MM;
      const stampWidth = 28;
      const stampHeight = stampWidth * (stampImg.height / stampImg.width);

      pdf.addImage(
        stampImg,
        "PNG",
        signatureCenterX - stampWidth / 2,
        signatureLineY - stampHeight,
        stampWidth,
        stampHeight,
      );
      pdf.setDrawColor(75, 85, 99);
      pdf.setLineWidth(0.25);
      pdf.line(signatureX, signatureLineY, signatureX + signatureWidth, signatureLineY);
      pdf.setTextColor(30, 58, 95);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.text("Authorised Signature", signatureCenterX, signatureLineY + 4, { align: "center" });

      pdf.setFillColor(30, 58, 95);
      pdf.rect(0, bannerY, pageWidth, 11, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.text("Thank you for your business!", pageWidth / 2, pageHeight - 4, { align: "center" });

      pdf.setTextColor(219, 231, 246);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(6.5);
      pdf.text(`Page ${i} of ${totalPages}`, pageWidth - 8, pageHeight - 4, { align: "right" });

      pdf.setFillColor(200, 164, 58);
      pdf.rect(0, pageHeight - 1, pageWidth, 1, "F");
    }
  }
}

