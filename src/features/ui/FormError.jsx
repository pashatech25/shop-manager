export default function FormError({errors, name}){
  const e=errors?.[name];
  if(!e) return null;
  return <span className="tiny" style={{color:'#c92a2a'}}>{e.message||'Invalid'}</span>;
}
