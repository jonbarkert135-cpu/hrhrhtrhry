"""Generate a closed 3D relief of Raven's own emblem, without a third-party model.
Run: python scripts/artwork/raven-sculpture.py (Pillow, NumPy, SciPy, build tooling only).
"""
from pathlib import Path
import struct
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, gaussian_filter, map_coordinates
from scipy.spatial import Delaunay

size=144
image=np.array(Image.open('apps/web/public/brand/raven-mark-512.png').convert('RGBA').resize((size,size),Image.Resampling.LANCZOS))/255
alpha=image[:,:,3]
threshold=.28
light=gaussian_filter((image[:,:,:3]*np.array([.2126,.7152,.0722])).sum(axis=2),1.7)
inside=np.clip(distance_transform_edt(alpha>threshold)/2.5,0,1)
points={}
def point(y,x):points[(round(y,4),round(x,4))]=(y,x)
for y in range(0,size,2):
    for x in range(0,size,2):
        if alpha[y,x]>threshold:point(y,x)
# Subpixel alpha-contour samples remove stair-stepped grid edges
for y in range(size-1):
    for x in range(size-1):
        for a,b in [((y,x),(y,x+1)),((y,x),(y+1,x))]:
            va,vb=alpha[a],alpha[b]
            if (va>threshold)!=(vb>threshold):
                t=(threshold-va)/(vb-va)
                point(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t)
coords=np.array(list(points.values()))
tri=Delaunay(coords).simplices
# Preserve feather gaps and concavities, rather than filling the convex hull
samples=np.stack([coords[tri].mean(axis=1),*( (coords[tri[:,i]]+coords[tri[:,(i+1)%3]])/2 for i in range(3))])
valid=np.all(map_coordinates(alpha,[samples[:,:,0].ravel(),samples[:,:,1].ravel()],order=1).reshape(4,-1)>=threshold-.035,axis=0)
tri=tri[valid]
height=map_coordinates(light,coords.T,order=1)
fade=map_coordinates(inside,coords.T,order=1)
depth=.045+fade*(.085+height*.065)
front=np.stack([(coords[:,1]/(size-1)-.5)*3.2,(.5-coords[:,0]/(size-1))*3.2,depth],axis=1).astype('f4')
for i,(a,b,c) in enumerate(tri):
    if np.cross(front[b]-front[a],front[c]-front[a])[2]<0:tri[i]=[a,c,b]
count=len(front)
back=front.copy();back[:,2]*=-1
vertices=np.concatenate((front,back))
faces=[tuple(v) for v in tri]+[(c+count,b+count,a+count) for a,b,c in tri]
boundary={}
for triangle in tri:
    t=tuple(triangle)
    for a,b in zip(t,t[1:]+t[:1]):
        key=tuple(sorted((a,b)))
        if key in boundary:boundary.pop(key)
        else:boundary[key]=(a,b)
for a,b in boundary.values():faces.extend([(a,b+count,b),(a,a+count,b+count)])
faces=np.array(faces,dtype=np.uint16)
normals=np.zeros_like(vertices)
for triangle in faces:
    a,b,c=vertices[triangle];normal=np.cross(b-a,c-a)
    for v in triangle:normals[v]+=normal
normals/=np.maximum(np.linalg.norm(normals,axis=1)[:,None],.000001)
data=np.concatenate((vertices,normals),axis=1).astype('<f4')
assert len(vertices)<65536
out=Path('apps/web/public/brand/raven-sculpture.bin')
out.write_bytes(struct.pack('<II',len(vertices),faces.size)+data.tobytes()+faces.astype('<u2').tobytes())
print(f'Raven relief: {len(vertices)} vertices, {len(faces)} triangles, {out.stat().st_size} bytes')
