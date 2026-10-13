// Shared Google Maps HTML used by both the native (WebView) and web (iframe)
// MapPicker. Two-way:
//  - Host -> map: window.setPin(lat,lng) or postMessage {type:'setPin'} moves
//    the pin (used when the user searches an address from the form).
//  - Map -> host: drag/click/place-search posts {lat,lng,address} (Google
//    reverse-geocoded) back to React Native.
export const GOOGLE_MAPS_KEY = "AIzaSyA05Qov2jduq-PjgCy0YQBRUsCNtLAaKTk";

export function buildMapHtml(lat: number, lng: number): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<style>
  html,body,#map{height:100%;margin:0;padding:0}
  #q{position:absolute;top:10px;left:10px;right:10px;z-index:10;box-sizing:border-box;
     padding:11px 12px;border-radius:10px;border:1px solid #ddd;font-size:14px;
     box-shadow:0 1px 5px rgba(0,0,0,.25);background:#fff}
  #gps{position:absolute;top:58px;right:10px;z-index:10;padding:9px 12px;border:0;border-radius:10px;
     background:#A855F7;color:#fff;font-size:13px;box-shadow:0 1px 5px rgba(0,0,0,.3)}
  .pac-container{z-index:1000;border-radius:10px;font-family:sans-serif}
  #hint{position:absolute;bottom:10px;left:10px;right:10px;z-index:10;background:rgba(0,0,0,.62);
        color:#fff;font:12px sans-serif;padding:7px 10px;border-radius:8px;text-align:center;pointer-events:none}
</style></head><body>
<input id="q" placeholder="Ketik nama jalan / gedung / area..." autocomplete="off" />
<button id="gps" title="Lokasi saat ini">📍 Lokasi Saya</button>
<div id="map"></div>
<div id="hint">Geser / ketuk peta untuk memindahkan pin</div>
<script>
  var map, marker, geocoder, autocomplete, lastReq = 0;
  function post(lat, lng, address){
    var s = JSON.stringify({lat:lat, lng:lng, address:address});
    if (window.ReactNativeWebView) { window.ReactNativeWebView.postMessage(s); }
    else if (window.parent && window.parent !== window) { window.parent.postMessage(s, '*'); }
  }
  function reverse(lat, lng){
    var id = ++lastReq;
    geocoder.geocode({ location: { lat: lat, lng: lng } }).then(function(r){
      if (id !== lastReq) return;
      var a = (r.results && r.results[0] && r.results[0].formatted_address) || '';
      post(lat, lng, a);
    }).catch(function(){ if (id === lastReq) post(lat, lng, ''); });
  }
  // Move pin programmatically (host-driven) + reverse geocode.
  function setPin(lat, lng, recenter){
    var p = { lat: lat, lng: lng };
    marker.setPosition(p);
    if (recenter !== false){ map.panTo(p); if (map.getZoom() < 16) map.setZoom(16); }
    reverse(lat, lng);
  }
  window.setPin = setPin;
  window.initMap = function(){
    var init = { lat: ${lat}, lng: ${lng} };
    map = new google.maps.Map(document.getElementById('map'), {
      center: init, zoom: 16, mapTypeControl: false, streetViewControl: false, fullscreenControl: false
    });
    marker = new google.maps.Marker({ map: map, position: init, draggable: true });
    geocoder = new google.maps.Geocoder();
    marker.addListener('dragend', function(){ var p = marker.getPosition(); reverse(p.lat(), p.lng()); });
    map.addListener('click', function(e){ setPin(e.latLng.lat(), e.latLng.lng(), false); });
    autocomplete = new google.maps.places.Autocomplete(document.getElementById('q'), {
      fields: ['geometry', 'formatted_address', 'name'],
      componentRestrictions: { country: 'id' }
    });
    autocomplete.bindTo('bounds', map);
    autocomplete.addListener('place_changed', function(){
      var pl = autocomplete.getPlace();
      if (!pl.geometry || !pl.geometry.location) return;
      setPin(pl.geometry.location.lat(), pl.geometry.location.lng(), true);
    });
    reverse(${lat}, ${lng});
  };
  document.getElementById('gps').addEventListener('click', function(){
    if (!navigator.geolocation){ return; }
    var b=document.getElementById('gps'); b.textContent='Mencari...';
    navigator.geolocation.getCurrentPosition(function(pos){
      b.textContent='📍 Lokasi Saya';
      setPin(pos.coords.latitude, pos.coords.longitude, true);
    }, function(){ b.textContent='📍 Lokasi Saya'; alert('Tidak bisa ambil lokasi. Aktifkan izin lokasi / GPS.'); }, {enableHighAccuracy:true, timeout:10000});
  });
  window.addEventListener('message', function(e){
    try{ var m = (typeof e.data === 'string') ? JSON.parse(e.data) : e.data;
      if (m && m.type === 'setPin' && typeof m.lat === 'number') setPin(m.lat, m.lng, true);
    } catch(err){}
  });
</script>
<script async src="https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&loading=async&libraries=places&callback=initMap"></script>
</body></html>`;
}

export type MapPoint = { lat: number; lng: number; address?: string };
