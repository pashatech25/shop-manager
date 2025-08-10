// Generic PDF capture using html2canvas + jsPDF; saves to Supabase 'pdfs/<tenant>/<kind>/<code>.pdf'
import html2canvas from 'html2canvas';
import {jsPDF} from 'jspdf';
import {uploadPublicLike, signedUrl} from './storage.js';

export async function captureElementToPdf({element, tenantId, kind, code}){
  if(!element){ throw new Error('captureElementToPdf: element is required'); }
  const canvas = await html2canvas(element, {scale:2, useCORS:true, background:'#ffffff'});
  const img = canvas.toDataURL('image/png');
  const pdf = new jsPDF({unit:'pt', format:'a4'});
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  // Fit the image to width and scale height proportionally
  const imgProps = pdf.getImageProperties(img);
  const ratio = Math.min(pageWidth / imgProps.width, pageHeight / imgProps.height);
  const w = imgProps.width * ratio;
  const h = imgProps.height * ratio;

  pdf.addImage(img, 'PNG', (pageWidth-w)/2, 20, w, h);
  const blob = pdf.output('blob');

  const path = `${tenantId}/${kind}/${code}.pdf`;
  await uploadPublicLike('pdfs', path, blob);
  const url = await signedUrl('pdfs', path, 3600);
  return {path, url};
}
