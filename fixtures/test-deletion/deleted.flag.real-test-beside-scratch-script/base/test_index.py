import numpy as np
import pandas as pd

df = pd.DataFrame({"t": [1, 2, 8, 9, 15]})
gaps = np.array([2, 4])

print("list:", gaps.tolist())
print("index:", df.index[gaps].tolist())
