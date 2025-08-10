export default function Spinner({size=18, label=''}){
  const s={width:size, height:size, border:'2px solid #ccc', borderTopColor:'#333', borderRadius:'50%', animation:'spin .8s linear infinite'};
  return (
    <span style={{display:'inline-flex', alignItems:'center', gap:8}}>
      <i style={s}/>
      {label? <span className="tiny">{label}</span> : null}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </span>
  );
}
