import React from "react";
import { format } from "date-fns";

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

export function PdfFooter({ absolute = false }: { absolute?: boolean }) {
  const containerStyle: React.CSSProperties = absolute
    ? { position: "absolute", bottom: 0, left: 0, right: 0 }
    : { marginTop: "40px", breakInside: "avoid", pageBreakInside: "avoid" };

  return (
    <div style={containerStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: absolute ? "0 15mm" : "0 10mm", marginBottom: "16px" }}>
        <div style={{ width: "160px", textAlign: "center", borderTop: "1px solid #333", paddingTop: "4px", fontSize: "11px", fontWeight: "bold", color: NAVY }}>
          Customer's Signature
        </div>
        <div style={{ width: "160px", textAlign: "center", borderTop: "1px solid #333", paddingTop: "4px", fontSize: "11px", fontWeight: "bold", color: NAVY }}>
          Checked By
        </div>
        <div style={{ width: "160px", textAlign: "center", borderTop: "1px solid #333", paddingTop: "4px", fontSize: "11px", fontWeight: "bold", color: NAVY, position: "relative" }}>
          <img 
            src={OFFICIAL_IDENTITY.stampUrl}
            alt="Stamp"
            style={{
              position: "absolute",
              bottom: "10px",
              left: "50%",
              transform: "translateX(-50%)",
              width: "110px",
              height: "auto",
              opacity: 0.9,
              pointerEvents: "none",
            }}
          />
          Authorised Signature
        </div>
      </div>
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

  const [logoImg, stampImg] = await Promise.all([
    loadImg(OFFICIAL_IDENTITY.logoUrl),
    loadImg(OFFICIAL_IDENTITY.stampUrl)
  ]);

  const totalPages = pdf.internal.getNumberOfPages();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    
    // Top Gold Bar (flush top)
    pdf.setFillColor(200, 164, 58); // GOLD approx
    pdf.rect(0, 0, pageWidth, 2, "F");
    
    // Header
    if (logoImg.width > 0) {
      const logoAspect = logoImg.height / logoImg.width;
      const logoW = 36;
      const logoH = logoW * logoAspect;
      pdf.addImage(logoImg, "JPEG", 10, 4, logoW, logoH);

      pdf.setTextColor(30, 58, 95); // NAVY
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      pdf.text(OFFICIAL_IDENTITY.companyName, 50, 7);

      pdf.setTextColor(51, 51, 51);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.2);
      pdf.text(OFFICIAL_IDENTITY.address.join(" "), 50, 12);
      pdf.text(
        `Phone: ${OFFICIAL_IDENTITY.phone}   Email: ${OFFICIAL_IDENTITY.email}   TRN: ${OFFICIAL_IDENTITY.trn}`,
        50,
        16.5,
      );
    }

    pdf.setTextColor(119, 119, 119);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.text(`Generated by ${options.userName} on ${format(new Date(), "dd/MM/yyyy hh:mm a")}`, pageWidth - 10, 22, { align: "right" });

    // Title strip
    pdf.setFillColor(30, 58, 95);
    pdf.rect(0, 27, pageWidth, 9, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.text(options.title.toUpperCase(), 10, 32.9);

    // Criteria strip
    pdf.setFillColor(245, 243, 238);
    pdf.rect(10, 38, pageWidth - 20, 7, "F");
    pdf.setTextColor(30, 58, 95);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.text(options.subtitle, 12, 42.6, { maxWidth: pageWidth - 24 });

    // The HTML table header is part of the first page's source content.
    // html2pdf rasterizes the DOM, so repeat it here on continuation pages.
    if (i > 1) {
      let columnX = 10;
      const columnY = 47;
      const columnHeight = 7;
      pdf.setFillColor(30, 58, 95);
      pdf.setDrawColor(255, 255, 255);
      pdf.setLineWidth(0.15);
      pdf.setTextColor(255, 255, 255);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(6.5);

      for (const column of options.columns) {
        pdf.rect(columnX, columnY, column.width, columnHeight, "FD");
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

    // Footer - Banner (flush bottom)
    pdf.setFillColor(30, 58, 95);
    pdf.rect(0, pageHeight - 12, pageWidth, 11, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text("Thank you for your business!", pageWidth / 2, pageHeight - 4, { align: "center" });

    // Page Number
    pdf.setTextColor(219, 231, 246);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6.5);
    pdf.text(`Page ${i} of ${totalPages}`, pageWidth - 8, pageHeight - 4, { align: "right" });

    pdf.setFillColor(200, 164, 58);
    pdf.rect(0, pageHeight - 1, pageWidth, 1, "F");

    // Last page signatures
    if (i === totalPages) {
      const sigY = pageHeight - 20;
      const lineY = sigY - 4;
      
      pdf.setDrawColor(51, 51, 51);
      pdf.setLineWidth(0.3);
      
      pdf.setTextColor(30, 58, 95);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);

      // Customer
      pdf.line(15, lineY, 65, lineY);
      pdf.text("Customer's Signature", 40, sigY, { align: "center" });

      // Checked By
      pdf.line(80, lineY, 130, lineY);
      pdf.text("Checked By", 105, sigY, { align: "center" });

      // Authorised
      const authCenterX = pageWidth - 40;
      if (stampImg.width > 0) {
        const stampAspect = stampImg.height / stampImg.width;
        const stampW = 32;
        const stampH = stampW * stampAspect;
        pdf.addImage(stampImg, "PNG", authCenterX - stampW / 2, lineY - stampH + 4, stampW, stampH);
      }
      pdf.line(pageWidth - 65, lineY, pageWidth - 15, lineY);
      pdf.text("Authorised Signature", authCenterX, sigY, { align: "center" });
    }
  }
}

